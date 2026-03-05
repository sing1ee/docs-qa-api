import "dotenv/config";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { buildIndex } from "./indexer.js";
import { createProvider } from "./llm.js";
import { runAgent } from "./agent.js";

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

app.post("/api/ask", async (c) => {
  const body = await c.req.json<{ question: string }>();
  if (!body.question) {
    return c.json({ error: "question is required" }, 400);
  }

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
