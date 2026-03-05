import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { toolDefinitions } from "./tools.js";

// Unified types

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ToolCall[];
  /** Gemini 多轮 tool call 时必带，与 tool_calls 一一对应或仅一个用于整轮 */
  thoughtSignatures?: string[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type StreamEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_calls"; calls: ToolCall[]; thoughtSignatures?: string[] }
  | { type: "done" };

/** 单轮发送内容：用户文本 或 多条 tool 的 functionResponse parts */
export type SendInput = string | Array<{ name: string; result: string }>;

/** 会话：按轮发送，由 SDK 管理 history（Gemini 含 thought_signature） */
export interface StreamSession {
  sendAndStream(input: SendInput): AsyncGenerator<StreamEvent>;
}

export interface LLMProvider {
  stream(messages: Message[]): AsyncGenerator<StreamEvent>;
  /** 创建会话（Gemini 用 Chat API 自动管理 thought_signature；未实现则用 stream） */
  createSession?(systemPrompt: string): StreamSession;
}

// --- Gemini Provider ---

const geminiTools = [
  {
    functionDeclarations: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    })),
  },
];

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model = "gemini-3.1-flash-lite-preview") {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  createSession(systemPrompt: string): StreamSession {
    const chat = this.ai.chats.create({
      model: this.model,
      config: {
        systemInstruction: systemPrompt,
        tools: geminiTools,
      },
    });

    return {
      async *sendAndStream(input: SendInput): AsyncGenerator<StreamEvent> {
        const message =
          typeof input === "string"
            ? input
            : input.map((r) => ({ functionResponse: { name: r.name, response: { result: r.result } } }));

        const response = await chat.sendMessageStream({ message: message as any });

        const toolCalls: ToolCall[] = [];
        let callIndex = 0;

        for await (const chunk of response) {
          if (!chunk.candidates?.[0]?.content?.parts) continue;

          for (const part of chunk.candidates[0].content.parts) {
            if (part.text) {
              yield { type: "text_delta", content: part.text };
            }
            if (part.functionCall) {
              toolCalls.push({
                id: `call_${callIndex++}`,
                name: part.functionCall.name!,
                arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
              });
            }
          }
        }

        if (toolCalls.length > 0) {
          yield { type: "tool_calls", calls: toolCalls };
        }
        yield { type: "done" };
      },
    };
  }

  async *stream(messages: Message[]): AsyncGenerator<StreamEvent> {
    // 无会话时仅支持单轮（首条用户消息）；多轮请由 agent 使用 createSession
    const toSend = this.getSendInput(messages);
    if (toSend === null) {
      yield { type: "done" };
      return;
    }
    const session = this.createSession(messages.find((m) => m.role === "system")?.content ?? "");
    yield* session.sendAndStream(toSend);
  }

  /** 从 messages 解析本轮要发送的内容：仅 [system, user] 或 末尾为 tool 时 */
  private getSendInput(messages: Message[]): SendInput | null {
    if (messages.length === 2 && messages[1].role === "user") {
      return messages[1].content ?? "";
    }
    const toolMessages = this.getLastToolMessages(messages);
    if (toolMessages.length > 0) {
      return toolMessages.map((m) => ({ name: m.name!, result: m.content ?? "" }));
    }
    return null;
  }

  private getLastToolMessages(messages: Message[]): Message[] {
    let i = messages.length - 1;
    while (i >= 0 && messages[i].role === "tool") i--;
    return messages.slice(i + 1);
  }
}

// --- OpenRouter Provider (OpenAI-compatible) ---

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "google/gemini-3.1-flash-lite-preview") {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    this.model = model;
  }

  async *stream(messages: Message[]): AsyncGenerator<StreamEvent> {
    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content ?? "",
          tool_call_id: m.tool_call_id ?? "",
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant" as const,
          content: m.content ?? null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: m.role, content: m.content ?? "" };
    });

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages as any,
      tools: toolDefinitions.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      stream: true,
    });

    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: "text_delta", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            toolCalls.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              args: tc.function?.arguments ?? "",
            });
          } else {
            if (tc.function?.arguments) existing.args += tc.function.arguments;
          }
        }
      }
    }

    if (toolCalls.size > 0) {
      const calls: ToolCall[] = [];
      for (const [, tc] of toolCalls) {
        try {
          calls.push({
            id: tc.id,
            name: tc.name,
            arguments: JSON.parse(tc.args),
          });
        } catch {
          calls.push({ id: tc.id, name: tc.name, arguments: {} });
        }
      }
      yield { type: "tool_calls", calls };
    }

    yield { type: "done" };
  }
}

/** Create LLM provider from environment variables */
export function createProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? "gemini";

  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is required");
    return new OpenRouterProvider(key, process.env.LLM_MODEL ?? "google/gemini-3.1-flash-lite-preview");
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required");
  return new GeminiProvider(key, process.env.LLM_MODEL ?? "gemini-3.1-flash-lite-preview");
}
