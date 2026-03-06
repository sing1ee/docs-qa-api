import { text, select, password, confirm, isCancel, cancel, log } from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";

export interface AppConfig {
  DOCS_DIR: string;
  LLM_PROVIDER: "gemini" | "openrouter";
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  LLM_MODEL?: string;
  PORT?: string;
  API_KEY?: string;
}

const ENV_PATH = () => resolve(process.cwd(), ".env");

function maskSecret(val: string | undefined): string {
  if (!val) return "(not set)";
  if (val.length <= 8) return "****";
  return val.slice(0, 4) + "..." + val.slice(-4);
}

function serializeEnv(config: AppConfig): string {
  const lines: string[] = [];
  lines.push(`DOCS_DIR=${config.DOCS_DIR}`);
  lines.push(`LLM_PROVIDER=${config.LLM_PROVIDER}`);
  if (config.GEMINI_API_KEY) lines.push(`GEMINI_API_KEY=${config.GEMINI_API_KEY}`);
  if (config.OPENROUTER_API_KEY) lines.push(`OPENROUTER_API_KEY=${config.OPENROUTER_API_KEY}`);
  if (config.LLM_MODEL) lines.push(`LLM_MODEL=${config.LLM_MODEL}`);
  if (config.PORT) lines.push(`PORT=${config.PORT}`);
  if (config.API_KEY) lines.push(`API_KEY=${config.API_KEY}`);
  return lines.join("\n") + "\n";
}

function handleCancel(value: unknown): asserts value is string {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

/** 从 .env 文件加载配置（不污染 process.env） */
export function loadEnvFile(): Record<string, string> | null {
  const envPath = ENV_PATH();
  if (!existsSync(envPath)) return null;
  return parseDotenv(readFileSync(envPath));
}

/** 加载配置：.env + process.env 合并，校验必填项 */
export function loadConfig(): AppConfig | null {
  const env = { ...loadEnvFile(), ...process.env };
  if (!env.DOCS_DIR) return null;
  return {
    DOCS_DIR: env.DOCS_DIR,
    LLM_PROVIDER: (env.LLM_PROVIDER as AppConfig["LLM_PROVIDER"]) ?? "gemini",
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    LLM_MODEL: env.LLM_MODEL,
    PORT: env.PORT,
    API_KEY: env.API_KEY,
  };
}

/** 将配置写入 process.env */
export function applyConfig(config: AppConfig) {
  process.env.DOCS_DIR = config.DOCS_DIR;
  process.env.LLM_PROVIDER = config.LLM_PROVIDER;
  if (config.GEMINI_API_KEY) process.env.GEMINI_API_KEY = config.GEMINI_API_KEY;
  if (config.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = config.OPENROUTER_API_KEY;
  if (config.LLM_MODEL) process.env.LLM_MODEL = config.LLM_MODEL;
  if (config.PORT) process.env.PORT = config.PORT;
  if (config.API_KEY) process.env.API_KEY = config.API_KEY;
}

/** 显示当前配置摘要 */
export function showConfigSummary(config: AppConfig) {
  const apiKey =
    config.LLM_PROVIDER === "gemini"
      ? config.GEMINI_API_KEY
      : config.OPENROUTER_API_KEY;

  log.info(
    [
      `  DOCS_DIR:     ${config.DOCS_DIR}`,
      `  LLM_PROVIDER: ${config.LLM_PROVIDER}`,
      `  API Key:      ${maskSecret(apiKey)}`,
      `  LLM_MODEL:    ${config.LLM_MODEL ?? "(default)"}`,
      `  PORT:         ${config.PORT ?? "3000"}`,
      `  AUTH:         ${config.API_KEY ? maskSecret(config.API_KEY) : "(disabled)"}`,
    ].join("\n")
  );
}

/** 交互式配置向导 */
export async function runConfigWizard(opts?: { existing?: AppConfig | null }): Promise<AppConfig> {
  const existing = opts?.existing ?? null;

  const docsDir = await text({
    message: "Codebase directory to index",
    placeholder: process.cwd(),
    defaultValue: existing?.DOCS_DIR ?? process.cwd(),
    validate: (v) => {
      if (!v || !existsSync(v)) return "Directory does not exist";
    },
  });
  handleCancel(docsDir);

  const provider = await select({
    message: "LLM Provider",
    options: [
      { value: "gemini" as const, label: "Google Gemini", hint: "recommended" },
      { value: "openrouter" as const, label: "OpenRouter", hint: "OpenAI-compatible, supports many models" },
    ],
    initialValue: existing?.LLM_PROVIDER ?? "gemini",
  });
  handleCancel(provider);

  let geminiKey: string | undefined;
  let openrouterKey: string | undefined;

  if (provider === "gemini") {
    const key = await password({
      message: "Gemini API Key",
      validate: (v) => {
        if (!v) return "API key is required";
      },
    });
    handleCancel(key);
    geminiKey = key;
  } else {
    const key = await password({
      message: "OpenRouter API Key",
      validate: (v) => {
        if (!v) return "API key is required";
      },
    });
    handleCancel(key);
    openrouterKey = key;
  }

  const defaultModel =
    provider === "gemini" ? "gemini-2.5-flash" : "google/gemini-2.5-flash";
  const model = await text({
    message: "Model name",
    placeholder: defaultModel,
    defaultValue: existing?.LLM_MODEL ?? defaultModel,
  });
  handleCancel(model);

  const port = await text({
    message: "Server port",
    placeholder: "3000",
    defaultValue: existing?.PORT ?? "3000",
    validate: (v) => {
      if (!v || !/^\d+$/.test(v)) return "Must be a number";
      const n = Number(v);
      if (n < 1 || n > 65535) return "Must be between 1-65535";
    },
  });
  handleCancel(port);

  const authKey = await text({
    message: "API auth key (leave empty to disable)",
    placeholder: "optional",
    defaultValue: existing?.API_KEY ?? "",
  });
  handleCancel(authKey);

  const config: AppConfig = {
    DOCS_DIR: docsDir,
    LLM_PROVIDER: provider as AppConfig["LLM_PROVIDER"],
    GEMINI_API_KEY: geminiKey,
    OPENROUTER_API_KEY: openrouterKey,
    LLM_MODEL: model || undefined,
    PORT: port || undefined,
    API_KEY: authKey || undefined,
  };

  const shouldSave = await confirm({ message: "Save configuration to .env?" });
  if (isCancel(shouldSave)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  if (shouldSave) {
    writeFileSync(ENV_PATH(), serializeEnv(config));
    log.success("Saved to .env");
  }

  return config;
}
