import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { toolDefinitions } from "./tools.js";

// Unified types

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ToolCall[];
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
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "done" };

export interface LLMProvider {
  stream(messages: Message[]): AsyncGenerator<StreamEvent>;
}

// --- Gemini Provider ---

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model = "gemini-3.1-flash-lite-preview") {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async *stream(messages: Message[]): AsyncGenerator<StreamEvent> {
    const { systemInstruction, contents } = this.convertMessages(messages);

    const response = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: [
          {
            functionDeclarations: toolDefinitions.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters as any,
            })),
          },
        ],
      },
    });

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
  }

  private convertMessages(messages: Message[]) {
    let systemInstruction: string | undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = msg.content;
        continue;
      }

      if (msg.role === "user") {
        contents.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (msg.role === "assistant") {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            parts.push({
              functionCall: { name: tc.name, args: tc.arguments },
            });
          }
        }
        contents.push({ role: "model", parts });
      } else if (msg.role === "tool") {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: msg.name,
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    return { systemInstruction, contents };
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
