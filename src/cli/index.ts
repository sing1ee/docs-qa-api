import { parseArgs } from "node:util";
import { intro, outro, select, log, isCancel, cancel } from "@clack/prompts";
import pc from "picocolors";
import {
  loadConfig,
  runConfigWizard,
  applyConfig,
  showConfigSummary,
} from "./config.js";
import { startChat } from "./chat.js";
import { startServer } from "../server.js";

function printHelp() {
  console.log(`
${pc.bold("docs-qa-agent")} — LLM-powered codebase Q&A

${pc.dim("Usage:")}
  docs-qa-agent              Interactive setup wizard
  docs-qa-agent --serve      Start HTTP server (uses existing .env)
  docs-qa-agent --chat       Interactive chat in terminal
  docs-qa-agent --config     Run configuration wizard only

${pc.dim("Options:")}
  -h, --help     Show this help message
  -v, --version  Show version
`);
}

export async function main() {
  const { values } = parseArgs({
    options: {
      serve: { type: "boolean", default: false },
      chat: { type: "boolean", default: false },
      config: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(dir, "../../package.json"), "utf-8"));
    console.log(pkg.version);
    process.exit(0);
  }

  intro(pc.bold("docs-qa-agent"));

  if (values.serve) {
    const config = loadConfig();
    if (!config) {
      log.error("No configuration found. Run without --serve to set up.");
      process.exit(1);
    }
    applyConfig(config);
    showConfigSummary(config);
    await startServer();
    return;
  }

  if (values.chat) {
    const config = loadConfig();
    if (!config) {
      log.error("No configuration found. Run without --chat to set up.");
      process.exit(1);
    }
    applyConfig(config);
    showConfigSummary(config);
    await startChat();
    return;
  }

  if (values.config) {
    const existing = loadConfig();
    await runConfigWizard({ existing });
    outro("Done!");
    return;
  }

  // 默认交互式流程
  const existing = loadConfig();

  let config;
  if (existing) {
    log.info("Found existing configuration:");
    showConfigSummary(existing);

    const action = await select({
      message: "What would you like to do?",
      options: [
        { value: "serve" as const, label: "Start HTTP server" },
        { value: "chat" as const, label: "Start interactive chat" },
        { value: "edit" as const, label: "Edit configuration" },
      ],
    });

    if (isCancel(action)) {
      cancel("Cancelled.");
      process.exit(0);
    }

    if (action === "edit") {
      config = await runConfigWizard({ existing });
    } else {
      config = existing;
    }

    applyConfig(config);

    if (action === "serve") {
      await startServer();
      return;
    }
    if (action === "chat") {
      await startChat();
      return;
    }
  } else {
    config = await runConfigWizard();
    applyConfig(config);
  }

  // 配置完成后选择下一步
  const next = await select({
    message: "What would you like to do next?",
    options: [
      { value: "serve" as const, label: "Start HTTP server" },
      { value: "chat" as const, label: "Start interactive chat" },
      { value: "exit" as const, label: "Exit" },
    ],
  });

  if (isCancel(next) || next === "exit") {
    outro("Bye!");
    return;
  }

  if (next === "serve") {
    await startServer();
  } else if (next === "chat") {
    await startChat();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
