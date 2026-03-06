# docs-qa-agent

LLM-powered Q&A agent for your codebase.
Index your project and ask questions — via interactive CLI, terminal chat, or HTTP API with SSE streaming.

---

## Quick Start

```bash
npx docs-qa-agent
```

The interactive wizard will guide you through configuration (LLM provider, API key, project directory, etc.) and save settings to `.env`.

### Other modes

```bash
npx docs-qa-agent --chat       # Interactive chat in terminal (no HTTP server)
npx docs-qa-agent --serve      # Start HTTP server directly (uses existing .env)
npx docs-qa-agent --config     # Run configuration wizard only
npx docs-qa-agent --help       # Show help
```

---

## Requirements

- **Node.js** 18+ (20+ recommended)
- A readable project directory to index
- Either a **Gemini API key** or an **OpenRouter API key**

## Installation

### Use directly with npx (recommended)

```bash
npx docs-qa-agent
```

### Or install globally

```bash
npm install -g docs-qa-agent
docs-qa-agent
```

### Or clone for development

```bash
git clone https://github.com/sing1ee/docs-qa-api.git
cd docs-qa-api
npm install
npm run cli
```

## Configuration

All settings can be configured interactively via the TUI wizard, or manually via environment variables / `.env` file.

### Environment variables

| Variable             | Required   | Description                                                                 |
|----------------------|------------|-----------------------------------------------------------------------------|
| `DOCS_DIR`           | **Yes**    | Root directory of the codebase to index                                     |
| `GEMINI_API_KEY`     | Gemini     | API key from [Google AI Studio](https://aistudio.google.com/apikey)         |
| `OPENROUTER_API_KEY` | OpenRouter | API key from [OpenRouter](https://openrouter.ai/keys)                       |
| `LLM_PROVIDER`       | No         | `gemini` (default) or `openrouter`                                          |
| `LLM_MODEL`          | No         | Model name (defaults vary by provider)                                      |
| `PORT`               | No         | HTTP port, default `3000`                                                   |
| `API_KEY`            | No         | If set, all API calls require `Authorization: Bearer <API_KEY>`             |

### Example `.env` file

```env
DOCS_DIR=/path/to/your/project
GEMINI_API_KEY=your_gemini_key
LLM_MODEL=gemini-2.5-flash
PORT=3000
```

---

## Usage

### Interactive Chat (recommended for exploration)

```bash
npx docs-qa-agent --chat
```

Ask questions directly in your terminal with streaming answers and tool call visualization:

```
❯ How is authentication implemented?

  ◆ grep({"pattern": "auth", "path": "src/"})
  ↳ src/server.ts:47: function requireBearerAuth...

The authentication is implemented via a Bearer token middleware...
```

Type `.exit` or press `Ctrl+C` to quit.

### HTTP Server

```bash
npx docs-qa-agent --serve
```

Starts the HTTP API server. On startup it will:

1. Scan `DOCS_DIR` and build an index (directory tree + exported symbols + markdown summaries)
2. Start listening on the configured port (default `3000`)

---

## HTTP API

### POST /api/ask

Stream answers via Server-Sent Events (SSE).

**Request**

```bash
curl -N -X POST http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_api_key' \
  -d '{"question": "How is the auth middleware implemented?"}'
```

**SSE events**

| Event         | Data                                 | Description                  |
|---------------|--------------------------------------|------------------------------|
| `delta`       | `{"content": "..."}`                 | Text delta                   |
| `tool_call`   | `{"name": "grep", "args": {...}}`    | Tool invocation              |
| `tool_result` | `{"name": "grep", "preview": "..."}` | Short summary of tool output |
| `done`        | `{}`                                 | Stream finished              |
| `error`       | `{"message": "..."}`                 | Error payload                |

### GET /health

```json
{ "status": "ok" }
```

---

## How It Works

```
startup → scan DOCS_DIR → build index (directory tree + file summaries + exported symbols)
                                ↓
user question → [LLM + index] → plan search → grep/read_file → not enough? → search again
                                                            ↓ enough
                                                       stream answer (with code refs + file paths)
```

### What gets indexed

- **TS/JS files**: exported functions, classes, interfaces, types, and constants
- **Markdown files**: titles and short excerpts
- **Directory tree**: full project structure

### Built-in tools

- **`grep`**: keyword/regex search across the codebase (max 50 matches)
- **`read_file`**: read file content with optional line ranges

---

## Development

```bash
npm run dev          # Start HTTP server with tsx (auto-loads .env)
npm run cli          # Run TUI locally with tsx
npm run build        # Compile TypeScript to dist/
```

## License

[MIT](LICENSE)
