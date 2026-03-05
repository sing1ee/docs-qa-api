import type { LLMProvider, Message, StreamEvent } from "./llm.js";
import { executeTool } from "./tools.js";

export type SSEEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; preview: string }
  | { type: "done" }
  | { type: "error"; message: string };

const MAX_TOOL_ROUNDS = 10;

const SYSTEM_PROMPT = `你是一个代码库问答助手。

<project-index>
{INDEX}
</project-index>

你可以使用以下工具搜索代码库：
- grep: 搜索关键词或正则表达式
- read_file: 读取文件内容

回答问题的策略：
1. 根据索引中的文件列表和导出符号，判断哪些文件可能相关
2. 用 grep 搜索关键词验证和定位
3. 用 read_file 阅读关键代码段
4. 如果第一轮搜索结果不足，换关键词或查看相关文件继续搜索
5. 基于代码和文档给出准确回答，引用文件路径和行号

注意：
- 优先搜索代码，文档作为补充
- 回答要具体，引用实际代码
- 如果代码库中没有相关内容，明确告知`;

export async function* runAgent(
  question: string,
  index: string,
  projectDir: string,
  provider: LLMProvider
): AsyncGenerator<SSEEvent> {
  const systemPrompt = SYSTEM_PROMPT.replace("{INDEX}", index);
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let hasToolCalls = false;
    let textContent = "";

    try {
      for await (const event of provider.stream(messages)) {
        if (event.type === "text_delta") {
          textContent += event.content;
          yield { type: "delta", content: event.content };
        } else if (event.type === "tool_calls") {
          hasToolCalls = true;

          // Add assistant message with tool calls
          messages.push({
            role: "assistant",
            content: textContent || undefined,
            tool_calls: event.calls,
          });

          // Execute each tool and send results
          for (const call of event.calls) {
            yield { type: "tool_call", name: call.name, args: call.arguments };

            const result = executeTool(projectDir, call.name, call.arguments);
            const preview =
              result.length > 200
                ? result.slice(0, 200) + "..."
                : result;

            yield { type: "tool_result", name: call.name, preview };

            messages.push({
              role: "tool",
              content: result,
              tool_call_id: call.id,
              name: call.name,
            });
          }
        }
      }
    } catch (e: any) {
      yield { type: "error", message: e.message };
      return;
    }

    // If no tool calls, the agent is done answering
    if (!hasToolCalls) {
      break;
    }
  }

  yield { type: "done" };
}
