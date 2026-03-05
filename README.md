# docs-qa-api

LLM-powered Q&A API for your codebase.  
On startup the server builds an index of your project (directory tree, exported TS/JS symbols, markdown summaries), then uses multi-turn tool calling to search code and docs and streams answers over SSE.

---

## Requirements

- **Node.js** 18+ (20+ recommended)  
- A readable project directory to index (`DOCS_DIR`)  
- Either a **Gemini API key** or an **OpenRouter API key**

## Installation

```bash
git clone <repo-url>
cd docs-qa-api
pnpm install
```

## Configuration

The server is configured via environment variables.  
On startup it automatically loads a `.env` file from the project root (if present); values passed on the command line override `.env`.

### Environment variables

| Variable             | Required | Description                                                                                             |
|----------------------|----------|---------------------------------------------------------------------------------------------------------|
| `DOCS_DIR`           | **Yes**  | Root directory of the codebase to index (absolute or relative path)                                    |
| `GEMINI_API_KEY`     | Gemini   | API key from [Google AI Studio](https://aistudio.google.com/apikey)                                    |
| `OPENROUTER_API_KEY` | OpenRouter | API key from [OpenRouter](https://openrouter.ai/keys)                                               |
| `LLM_PROVIDER`       | No       | `gemini` (default) or `openrouter`                                                                     |
| `LLM_MODEL`          | No       | Model name; Gemini default `gemini-3.1-flash-lite-preview`, OpenRouter default `google/gemini-3.1-flash-lite-preview` |
| `PORT`               | No       | HTTP port, default `3000`                                                                              |
| `API_KEY`            | No       | If set, all API calls must send `Authorization: Bearer <API_KEY>`                                      |

### Configuration examples

Option 1 – environment variables:

```bash
export DOCS_DIR=/path/to/your/project
export GEMINI_API_KEY=your_gemini_key
pnpm run dev
```

Option 2 – `.env` file (recommended, do not commit to git):

```env
# Required: codebase root
DOCS_DIR=/path/to/your/project

# Gemini (one of)
GEMINI_API_KEY=your_gemini_key

# Or OpenRouter
# LLM_PROVIDER=openrouter
# OPENROUTER_API_KEY=your_openrouter_key
# LLM_MODEL=google/gemini-3.1-flash-lite-preview

# Optional
PORT=3000
LLM_MODEL=gemini-3.1-flash-lite-preview
```

## Running

```bash
# Using Gemini (default)
DOCS_DIR=/path/to/your/project GEMINI_API_KEY=xxx pnpm run dev

# Using OpenRouter
DOCS_DIR=/path/to/your/project \
  LLM_PROVIDER=openrouter \
  OPENROUTER_API_KEY=xxx \
  LLM_MODEL=google/gemini-3.1-flash-lite-preview \
  pnpm run dev
```

Or run the TypeScript entry directly with `tsx`:

```bash
DOCS_DIR=/path/to/your/project GEMINI_API_KEY=xxx pnpm exec tsx src/server.ts
```

On startup the server will:

1. Scan `DOCS_DIR` and build an index (directory tree + exported TS/JS symbols + markdown summaries)  
2. Log index statistics and start listening on the configured port (default `3000`)  
3. Expose `http://localhost:3000/health` for health checks  

### Custom port

```bash
PORT=8080 DOCS_DIR=... GEMINI_API_KEY=... pnpm run dev
```

### Common errors

| Symptom                                            | Possible cause                                         |
|----------------------------------------------------|--------------------------------------------------------|
| `Error: DOCS_DIR environment variable is required` | `DOCS_DIR` not set                                    |
| `GEMINI_API_KEY is required`                       | Using default provider without a Gemini key           |
| `OPENROUTER_API_KEY is required`                   | `LLM_PROVIDER=openrouter` but OpenRouter key not set  |
| Requests hang or time out                          | Invalid API key or upstream LLM endpoint unreachable  |

---

## HTTP API

`POST /api/ask` — ask questions about your codebase and receive answers over SSE.  
`GET /health` — returns `{ "status": "ok" }` for health checks.

### POST /api/ask

Stream answers via Server-Sent Events (SSE).

**Request body**

```json
{ "question": "How is the auth middleware implemented?" }
```

**SSE events**

| event         | data                                | Description                     |
|---------------|-------------------------------------|---------------------------------|
| `delta`       | `{"content": "..."}`                | Text delta                      |
| `tool_call`   | `{"name": "grep", "args": {...}}`   | Tool invocation                 |
| `tool_result` | `{"name": "grep", "preview": "..."}`| Short summary of tool output    |
| `done`        | `{}`                                | Stream finished                 |
| `error`       | `{"message": "..."}`                | Error payload                   |

**Examples**

```bash
curl -N -X POST http://localhost:4000/api/ask \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_api_key' \
  -d '{"question": "How is the gateway semantic search configured?"}'

curl -N --noproxy '*' -X POST https://api.openclawagent.net/api/ask \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_api_key' \
  -d '{"question": "How is the gateway semantic search configured?"}'
```

### GET /health

Health check endpoint returning:

```json
{ "status": "ok" }
```

---

## How it works

```text
startup → scan DOCS_DIR → build index (directory tree + file summaries with exported symbols)
                                ↓
user question → [LLM + index] plan search → grep/read_file → not enough? → search again
                                                         ↓ enough
                                                    stream answer (with code + file paths)
```

### What gets indexed

- **TS/JS files**: extract all exported functions, classes, interfaces, types, and constants
- **Markdown files**: extract titles (`# ...`) and a short excerpt
- **Directory tree**: full project structure

### Built-in tools

- **`grep`**: keyword/regex search across the indexed codebase (returns matching lines, capped)
- **`read_file`**: read file content with optional line ranges
