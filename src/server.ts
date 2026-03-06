import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { buildIndex } from "./indexer.js";
import { createProvider } from "./llm.js";
import { runAgent } from "./agent.js";

export async function startServer() {
  const projectDir = process.env.DOCS_DIR;
  if (!projectDir) {
    console.error("Error: DOCS_DIR environment variable is required");
    process.exit(1);
  }

  console.log(`Building index for: ${projectDir}`);
  const index = await buildIndex(projectDir);
  console.log(`Index built (${index.length} chars)`);

  const provider = createProvider();
  const app = new Hono();

  // 简单请求日志中间件：记录方法、路径、IP、耗时
  app.use("*", async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const ip =
      c.req.header("x-forwarded-for") ??
      c.req.header("x-real-ip") ??
      "unknown";

    console.log(`[request] ${method} ${path} from ${ip}`);

    try {
      await next();
    } catch (e) {
      console.error(`[error] ${method} ${path}`, e);
      throw e;
    } finally {
      const ms = Date.now() - start;
      const status = c.res?.status ?? 0;
      console.log(`[response] ${method} ${path} ${status} ${ms}ms`);
    }
  });

  // 简单 Bearer 认证，中间件复用
  function requireBearerAuth(c: any, next: any) {
    const expected = process.env.API_KEY;
    // 未配置 API_KEY 时不启用鉴权，便于本地开发
    if (!expected) return next();

    const auth = c.req.header("authorization") ?? "";
    const prefix = "Bearer ";
    if (!auth.startsWith(prefix)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = auth.slice(prefix.length).trim();
    if (token !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  }

  app.post("/api/ask", requireBearerAuth, async (c) => {
    const body = await c.req.json<{ question: string }>();
    if (!body.question) {
      return c.json({ error: "question is required" }, 400);
    }

    console.log(
      `[ask] question: ${body.question.slice(0, 200)}${
        body.question.length > 200 ? "..." : ""
      }`
    );

    // Nginx 反代时必须禁用响应缓冲，否则 SSE 流会被吞
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      for await (const event of runAgent(body.question, index, projectDir, provider)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(
            event.type === "delta"
              ? { content: event.content }
              : event.type === "tool_call"
                ? { name: event.name, args: event.args }
                : event.type === "tool_result"
                  ? { name: event.name, preview: event.preview }
                  : event.type === "error"
                    ? { message: event.message }
                    : {}
          ),
        });
      }
    });
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  const port = Number(process.env.PORT ?? 3000);
  console.log(`Server running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}

// 直接运行时启动服务器（兼容 npm run dev）
const isDirectRun =
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js");

if (isDirectRun) {
  const { config } = await import("dotenv");
  config();
  await startServer();
}
