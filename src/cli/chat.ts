import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spinner, log } from "@clack/prompts";
import pc from "picocolors";
import { buildIndex } from "../indexer.js";
import { createProvider } from "../llm.js";
import { runAgent } from "../agent.js";

export async function startChat() {
  const projectDir = process.env.DOCS_DIR!;

  const s = spinner();
  s.start("Building codebase index...");
  const index = await buildIndex(projectDir);
  s.stop(`Index built (${index.length} chars)`);

  const provider = createProvider();

  log.info("Ask questions about your codebase. Type .exit or Ctrl+C to quit.\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const cleanup = () => {
    rl.close();
    console.log();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);

  try {
    while (true) {
      const question = await rl.question(pc.cyan("❯ "));
      if (!question.trim()) continue;
      if (question.trim() === ".exit") break;

      for await (const event of runAgent(question, index, projectDir, provider)) {
        switch (event.type) {
          case "delta":
            process.stdout.write(event.content);
            break;
          case "tool_call":
            process.stdout.write(
              pc.dim(`\n  ◆ ${event.name}(${JSON.stringify(event.args)})\n`)
            );
            break;
          case "tool_result":
            process.stdout.write(pc.dim(`  ↳ ${event.preview}\n`));
            break;
          case "done":
            process.stdout.write("\n\n");
            break;
          case "error":
            log.error(event.message);
            break;
        }
      }
    }
  } finally {
    rl.close();
  }
}
