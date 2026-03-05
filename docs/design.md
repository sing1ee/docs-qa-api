# 代码库 Q&A SSE API

## Context

为 TypeScript 代码库（代码 + 文档）构建问答 API。启动时构建代码库索引（目录结构 + 文件级摘要含导出符号），agent 通过多轮 tool calling 搜索代码库后回答问题，SSE 流式返回。

## 核心流程

```
用户提问
  ↓
[LLM + 索引] 分析问题，规划搜索策略
  ↓
[工具调用] grep / read_file 搜索代码库
  ↓
[LLM] 结果够了吗？
  ├─ 不够 → 换关键词/查相关文件，再搜
  └─ 够了 → 基于搜索结果回答
  ↓
SSE 流式返回
```

关键：agent loop 支持**多轮工具调用**，LLM 自主决定何时搜索够了。

## 索引策略（TypeScript）

### 目录树
```
src/
├── auth/
│   ├── oauth.ts
│   └── middleware.ts
├── api/
│   └── routes.ts
docs/
├── getting-started.md
└── api.md
```

### 文件级摘要
对每个文件提取：
- **TS 文件**：所有 `export` 的函数名、类名、接口名、类型名、常量名（用正则提取 `export (default )?(function|class|interface|type|const|enum) NAME`）
- **MD 文件**：标题（`#` 行）+ 前 3 行正文
- 文件路径 + 行数

示例输出：
```
- src/auth/oauth.ts (120 lines)
  exports: createOAuthClient, OAuthConfig, validateToken, refreshToken
- src/auth/middleware.ts (45 lines)
  exports: authMiddleware, requireRole
- docs/getting-started.md (80 lines)
  # Getting Started — 安装、配置、Quick Start
```

这样 LLM 看到索引就知道：问 OAuth 相关的 → 看 `src/auth/oauth.ts`，问部署 → 看 `docs/getting-started.md`。

## 实现步骤

### 1. 初始化项目

位置：`/Users/cheng/Downloads/Projects/workspace/docs-qa-api`

依赖：
- `@google/genai` — Gemini API（function calling + streaming）
- `openai` — OpenRouter 兼容
- `hono` + `@hono/node-server` — HTTP + SSE
- `tsx` — 运行 TS
- `glob` — 文件扫描

### 2. 代码库索引 `src/indexer.ts`

```typescript
buildIndex(projectDir: string): Promise<string>
```

- 用 glob 扫描文件（排除 node_modules, dist, .git 等）
- TS 文件：正则提取 export 符号
- MD 文件：提取标题 + 摘要
- 生成目录树 + 文件摘要的纯文本索引

### 3. 工具定义 `src/tools.ts`

| 工具 | 描述 | 参数 |
|------|------|------|
| `grep` | 在代码库中搜索关键词/正则 | `pattern: string, glob?: string` |
| `read_file` | 读取文件内容（支持行范围） | `path: string, startLine?: number, endLine?: number` |

实现用 Node.js `child_process.execSync('grep ...')` 和 `fs.readFileSync`，路径限制在项目目录内。

### 4. Agent Loop `src/agent.ts`

```typescript
async function* runAgent(question: string, index: string, opts: LLMOptions): AsyncGenerator<SSEEvent>
```

- 构造 messages: `[system(索引+指令), user(问题)]`
- 循环调用 LLM（stream 模式）
- 遇到 tool_call → 执行 → 追加结果 → 继续调用 LLM
- 遇到文本 → yield SSE delta 事件
- LLM 自主决定搜索轮次（无硬限制，靠 system prompt 引导）

### 5. LLM Provider `src/llm.ts`

统一接口：
```typescript
interface LLMProvider {
  chatStream(messages, tools): AsyncGenerator<StreamChunk>
}
```

两个实现：
- `GeminiProvider`：`@google/genai`，env `GEMINI_API_KEY`，默认模型 `gemini-3.1-flash-lite-preview`
- `OpenRouterProvider`：`openai` SDK，base URL `https://openrouter.ai/api/v1`，env `OPENROUTER_API_KEY`

通过 env `LLM_PROVIDER=gemini|openrouter` 切换。

### 6. System Prompt

```
你是一个代码库问答助手。

<project-index>
{索引内容}
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
- 如果代码库中没有相关内容，明确告知
```

### 7. HTTP 服务 `src/server.ts`

```
POST /api/ask  (SSE)
Body: { question: string }

SSE events:
  event: delta        data: {"content": "..."}
  event: tool_call    data: {"name": "grep", "args": {"pattern": "..."}}
  event: tool_result  data: {"name": "grep", "summary": "found 3 matches"}
  event: done         data: {}
  event: error        data: {"message": "..."}
```

### 8. 项目结构

```
docs-qa-api/
├── src/
│   ├── server.ts      # Hono 服务 + SSE endpoint
│   ├── agent.ts       # Agent loop（多轮 tool calling）
│   ├── llm.ts         # LLM provider 抽象
│   ├── tools.ts       # grep + read_file 实现
│   └── indexer.ts     # 代码库索引构建
├── package.json
└── tsconfig.json
```

## 验证方式

1. 启动：`DOCS_DIR=/path/to/project GEMINI_API_KEY=xxx npx tsx src/server.ts`
2. 测试：`curl -N -X POST http://localhost:3000/api/ask -H 'Content-Type: application/json' -d '{"question": "认证中间件是怎么实现的？"}'`
3. 确认：agent 根据索引定位到相关文件 → grep 搜索 → read_file 阅读 → 流式回答并引用代码
