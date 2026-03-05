# docs-qa-api

基于 LLM 的代码库问答 API。启动时自动构建代码库索引（目录结构 + TS 导出符号 + 文档摘要），通过多轮 tool calling 搜索代码和文档，SSE 流式返回答案。

---

## 前置要求

- **Node.js** 18+（推荐 20+）
- 代码库路径（`DOCS_DIR`）需存在且可读
- 任选其一：**Gemini API Key** 或 **OpenRouter API Key**

---

## 安装

```bash
git clone <repo-url>
cd docs-qa-api
pnpm install
```

---

## 配置

通过环境变量配置。**启动时会自动加载项目根目录的 `.env` 文件**，也可在命令行传入（命令行会覆盖 `.env` 中的同名字段）。

### 环境变量一览

| 变量 | 必填 | 说明 |
|------|------|------|
| `DOCS_DIR` | **是** | 要建立索引的代码库根目录（绝对或相对路径） |
| `GEMINI_API_KEY` | Gemini 时必填 | [Google AI Studio](https://aistudio.google.com/apikey) 获取 |
| `OPENROUTER_API_KEY` | OpenRouter 时必填 | [OpenRouter](https://openrouter.ai/keys) 获取 |
| `LLM_PROVIDER` | 否 | `gemini`（默认）或 `openrouter` |
| `LLM_MODEL` | 否 | 模型名；Gemini 默认 `gemini-3.1-flash-lite-preview`，OpenRouter 默认 `google/gemini-3.1-flash-lite-preview` |
| `PORT` | 否 | 服务端口，默认 `3000` |

### 配置示例

**方式一：命令行（适合临时跑）**

```bash
export DOCS_DIR=/path/to/your/project
export GEMINI_API_KEY=your_gemini_key
# 然后运行
pnpm run dev
```

**方式二：`.env` 文件（推荐，不提交到 git）**

在项目根目录创建 `.env`，启动时会自动加载：

```env
# 代码库路径（必填）
DOCS_DIR=/path/to/your/project

# Gemini（二选一）
GEMINI_API_KEY=your_gemini_key

# 或 OpenRouter
# LLM_PROVIDER=openrouter
# OPENROUTER_API_KEY=your_openrouter_key
# LLM_MODEL=google/gemini-3.1-flash-lite-preview

# 可选
PORT=3000
LLM_MODEL=gemini-3.1-flash-lite-preview
```

配置好后直接执行 `pnpm run dev` 即可。

---

## 运行

### 开发 / 本地运行

```bash
# 使用 Gemini（默认）
DOCS_DIR=/path/to/your/project GEMINI_API_KEY=xxx pnpm run dev

# 使用 OpenRouter
DOCS_DIR=/path/to/your/project \
  LLM_PROVIDER=openrouter \
  OPENROUTER_API_KEY=xxx \
  LLM_MODEL=google/gemini-3.1-flash-lite-preview \
  pnpm run dev
```

或直接用 `tsx`（无需预编译）：

```bash
DOCS_DIR=/path/to/your/project GEMINI_API_KEY=xxx pnpm exec tsx src/server.ts
```

启动后会：

1. 扫描 `DOCS_DIR` 并构建索引（目录树 + TS/JS 导出符号 + MD 摘要）
2. 打印索引大小并监听端口（默认 3000）
3. 可访问 `http://localhost:3000/health` 做健康检查

### 指定端口

```bash
PORT=8080 DOCS_DIR=... GEMINI_API_KEY=... pnpm run dev
```

### 常见问题

| 现象 | 可能原因 |
|------|----------|
| `Error: DOCS_DIR environment variable is required` | 未设置 `DOCS_DIR` |
| `GEMINI_API_KEY is required` | 使用默认 provider 但未设置 Gemini Key |
| `OPENROUTER_API_KEY is required` | `LLM_PROVIDER=openrouter` 但未设置 OpenRouter Key |
| 启动后请求超时/无响应 | 检查 API Key 是否有效、网络是否可访问对应 API |

---

## API

### POST /api/ask

SSE 流式返回回答。

**请求体：**

```json
{ "question": "认证中间件是怎么实现的？" }
```

**SSE 事件：**

| event | data | 说明 |
|-------|------|------|
| `delta` | `{"content": "..."}` | 文本增量 |
| `tool_call` | `{"name": "grep", "args": {...}}` | 工具调用 |
| `tool_result` | `{"name": "grep", "preview": "..."}` | 工具结果摘要 |
| `done` | `{}` | 结束 |
| `error` | `{"message": "..."}` | 错误 |

**示例：**

```bash
curl -N -X POST http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Openclaw 的 gateway 如何配置语义搜索呢"}'
```

### GET /health

健康检查，返回 `{"status":"ok"}`。

---

## 工作原理

```
启动 → 扫描 DOCS_DIR → 构建索引（目录树 + 文件摘要）
                              ↓
用户提问 → [LLM + 索引] 规划搜索 → grep/read_file → 结果不足？→ 继续搜索
                                                        ↓ 足够
                                                   流式回答（引用代码和文件路径）
```

**索引内容：**

- TS/JS 文件：提取所有 `export` 的函数、类、接口、类型、常量
- MD 文件：提取标题和前几行摘要
- 目录树：完整文件结构

**工具：**

- `grep` — 关键词/正则搜索，返回匹配行（限 50 条）
- `read_file` — 读取文件内容，支持行范围
