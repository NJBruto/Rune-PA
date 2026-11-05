# Rune PA

Rune is a local-first, JARVIS-style personal assistant. The HUD, microphone
meter, wake sound, boot sequence, and chat client run in the browser; a small
Node/Express server serves the app and proxies requests to local AI servers so
the browser never hits CORS restrictions.

There is no account, telemetry, or cloud service. Nothing leaves your machine
unless you explicitly configure a provider that points somewhere else.

## Architecture

```
React + Vite (browser)
  ├─ HUD, reactor, microphone meter, wake sound
  ├─ chat UI and conversation state
  ├─ Chrome built-in AI · WebLLM · WebSocket agent · Demo
  └─ fetch /api/*  ─────────────┐
                                │
Node + Express (server/index.js)
  ├─ serves the production build from dist/
  ├─ GET  /api/health
  ├─ GET  /api/detect     scans common local AI ports
  ├─ GET  /api/models     lists models from a provider
  └─ POST /api/chat       streams SSE to the browser
        ├─ Ollama        → /api/chat
        └─ OpenAI-compat → /v1/chat/completions
```

The backend proxies only `http://` and `https://` endpoints on localhost by
default. Set `RUNE_ALLOW_REMOTE=1` to allow other hosts.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8)
- npm 10+
- A modern browser (Chrome, Edge, or Firefox) for the HUD and chat
- Optional: a local AI server such as Ollama or LM Studio

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts both processes:

- Vite dev server: <http://127.0.0.1:5173>
- Node API server: <http://127.0.0.1:8787>

Vite proxies `/api` to the Node server, so open the Vite URL during
development.

### Production build

```bash
npm run build
npm start
```

Then open <http://127.0.0.1:8787>. The Node server serves `dist/` and falls back
to `dist/index.html` for client-side routes.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Runs the API server and Vite together |
| `npm run dev:client` | Vite only |
| `npm run dev:server` | Node API only, with `--watch` |
| `npm run build` | Builds the React app into `dist/` |
| `npm start` | Serves the built app and API |
| `npm run preview` | Vite preview of the build |

## Using the chat

1. Open **07 // CHAT MODE**.
2. Expand **CONFIG / LOCAL AI**.
3. Pick a provider, or press **DETECT LOCAL AI**.
4. Press **TEST**, then send a message.
5. Use **Demo** to test the interface with no model or server.

On first load Rune scans the common local ports automatically. If it finds a
server it fills in the provider, endpoint, and first available model.

## Providers

| Provider | Endpoint | Example model | Notes |
| --- | --- | --- | --- |
| Ollama | `http://localhost:11434` | `qwen3:1.7b` | Native `/api/chat`, proxied by Node |
| LM Studio | `http://localhost:1234/v1` | model shown in LM Studio | Start the local server |
| llama.cpp | `http://localhost:8080/v1` | whatever the server loads | `llama-server -m model.gguf` |
| Jan | `http://localhost:1337/v1` | model shown in Jan | OpenAI-compatible |
| vLLM | `http://localhost:8000/v1` | served model name | OpenAI-compatible |
| KoboldCpp | `http://localhost:5001/v1` | served model name | Enable the API |
| LocalAI | `http://localhost:8080/v1` | served model name | OpenAI-compatible |
| text-generation-webui | `http://localhost:5000/v1` | served model name | OpenAI-compatible extension |
| Chrome AI | *(no endpoint)* | `gemini-nano` | Chrome 138+, Prompt API |
| WebLLM | *(no endpoint)* | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | Runs in the tab via WebGPU |
| WebSocket | `ws://localhost:8765` | optional | Custom agent protocol |
| Demo | *(no endpoint)* | `rune-demo` | Works offline |

For OpenAI-compatible providers the base URL normally ends in `/v1`. Rune also
accepts a bare host such as `http://localhost:1234` and adds `/v1`.

### Qwen3 1.7B with Ollama

`qwen3:1.7b` is a good fit for this local test: it is small (about 1.4 GB), runs
on modest hardware, and is aimed at chat/assistant workloads.

```bash
ollama serve
ollama pull qwen3:1.7b
```

Then choose **Ollama**, endpoint `http://localhost:11434`, model `qwen3:1.7b`.

Qwen3 has a "thinking" mode that produces a long reasoning block before the
answer. It is off by default in Rune; enable **Qwen thinking mode** only when
you want deeper reasoning, and leave it off for snappy replies.

### LM Studio

1. Open LM Studio → Developer.
2. Start the local server.
3. Load a model and copy its name into Rune.
4. Endpoint: `http://localhost:1234/v1`.

### Chrome built-in AI

Requires Chrome 138+ on supported hardware with the Prompt API enabled. The
model may download on first use. Check `chrome://on-device-internals` if it is
unavailable.

### WebLLM

Requires WebGPU (Chrome or Edge). The first message downloads and caches the
model weights in the browser.

### WebSocket agent

Rune sends:

```json
{ "type": "chat", "messages": [], "model": "...", "stream": true }
```

The agent may stream `{ "delta": "..." }`, `{ "token": "..." }`,
`{ "content": "..." }`, or plain text chunks, then send `{ "type": "done" }`.
Send `{ "type": "error", "error": "..." }` on failure.

## Security and privacy

- The Node server binds to `127.0.0.1` by default.
- Proxy targets are restricted to localhost unless `RUNE_ALLOW_REMOTE=1` is set.
- `RUNE_ALLOW_REMOTE=1` lets the server reach remote endpoints; only use it when
  you trust the network and the endpoint.
- API keys are kept in `localStorage` and sent only to the configured endpoint.
- No analytics, tracking, or remote logging is included.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API/static server port |
| `HOST` | `127.0.0.1` | Bind address |
| `RUNE_ALLOW_REMOTE` | unset | `1` allows non-local proxy targets |

## Project layout

```
.
├── index.html              Vite entry shell
├── vite.config.js          React plugin + /api dev proxy
├── package.json
├── server/
│   └── index.js            Express static server + AI proxy
└── src/
    ├── main.jsx            React entry
    ├── App.jsx             boot sequence, status wiring, layout
    ├── styles.css          HUD, reactor, panels, chat styles
    ├── components/         BootScreen, BackgroundConsole, TopBar,
    │                       Reactor, Panels, ChatPanel, LogLine
    ├── hooks/              useLogs, useAudio, useChat
    └── lib/                chatConfig, providers, markdown, agent
```

## Troubleshooting

**The boot screen never clears.** It has a 20-second watchdog that reveals the
interface anyway. Check the browser console and the background log.

**No local AI found.** Start Ollama (`ollama serve`) or an OpenAI-compatible
server, then press **DETECT LOCAL AI**. Demo mode always works.

**Ollama says the model is missing.** Run `ollama pull <model>`; the error
message includes the exact command.

**Chat hangs or the connection closes.** Confirm the Node server is running and
check its terminal output. In development, Vite proxies `/api` to port 8787.

**Microphone does not start.** Browsers require a secure context
(`localhost` or HTTPS) and explicit permission. The HUD still works without it.

**Wake sound is silent.** Browsers block autoplay until a user gesture. Click
the page once; Rune plays the sound after the first interaction.

## License

Prototype project. Add a license before distributing.
