# Rune PA

Rune is a local-first, browser-based personal assistant prototype with a
JARVIS-style HUD. The interface, microphone meter, wake sound, and chat client
all run in the browser. There is no Rune backend, account, telemetry, or cloud
service.

The new chat mode can talk to a local AI running on your computer:

- **Ollama**
- **LM Studio**
- **llama.cpp server**
- **Jan**
- **vLLM**
- **KoboldCpp**
- **LocalAI**
- **text-generation-webui**
- **Chrome's built-in AI / Gemini Nano** (Prompt API)
- **Any custom WebSocket agent**
- **Demo mode** — no model or server required

## Quick start

`agent.js` and `rune-chat.js` are ES modules, so Rune must be served over HTTP.
Opening `index.html` directly from `file://` will not work.

```bash
./serve.sh
# or
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000>.

1. Open **07 // CHAT MODE**.
2. Expand **CONFIG / LOCAL AI**.
3. Pick a provider, or press **DETECT LOCAL AI**.
4. Press **TEST**, then send a message.
5. Use **Demo** if you only want to test the chat interface.

## Provider setup

| Provider | Endpoint | Example model | Notes |
| --- | --- | --- | --- |
| Ollama | `http://localhost:11434` | `llama3.2` | Native `/api/chat` streaming |
| LM Studio | `http://localhost:1234/v1` | model shown in LM Studio | Enable the local server and CORS |
| llama.cpp | `http://localhost:8080/v1` | whatever the server loads | `llama-server -m model.gguf` |
| Jan | `http://localhost:1337/v1` | model shown in Jan | OpenAI-compatible server |
| vLLM | `http://localhost:8000/v1` | served model name | OpenAI-compatible |
| KoboldCpp | `http://localhost:5001/v1` | served model name | Enable the API |
| LocalAI | `http://localhost:8080/v1` | served model name | OpenAI-compatible |
| text-generation-webui | `http://localhost:5000/v1` | served model name | OpenAI-compatible extension |
| Chrome AI | *(no endpoint)* | `gemini-nano` | Chrome 138+, Prompt API |
| WebLLM | *(no endpoint)* | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | Runs in the browser via WebGPU |
| WebSocket | `ws://localhost:8765` | optional | Custom agent protocol |
| Demo | *(no endpoint)* | `rune-demo` | Works offline |

For OpenAI-compatible providers, the base URL normally ends in `/v1`. Rune
also accepts a bare host such as `http://localhost:1234` and adds `/v1`.

### Ollama

```bash
ollama serve
ollama pull llama3.2
```

If the browser is blocked by CORS, restart Ollama with an allowed origin:

```bash
OLLAMA_ORIGINS=* ollama serve
```

For a narrower setting, use the exact page origin, for example
`OLLAMA_ORIGINS=http://127.0.0.1:8000`.

### LM Studio

1. Open LM Studio → Developer.
2. Start the local server.
3. Enable CORS in the server settings.
4. Use `http://localhost:1234/v1` in Rune.

### llama.cpp

```bash
llama-server -m model.gguf --host 127.0.0.1 --port 8080
```

Use `http://localhost:8080/v1`.

### Chrome built-in AI (Gemini Nano)

Choose **Chrome built-in AI**. This uses the Prompt API, not a local HTTP
server. It requires a supported Chrome version and hardware; the model may
download on first use. Check availability at `chrome://on-device-internals`.
Firefox and Safari do not currently provide this API.

### WebLLM (in-browser)

Choose **WebLLM (in-browser)** to run a model inside the tab with WebGPU. The
first message downloads and caches the model weights from the WebLLM CDN/model
host; later runs reuse the browser cache. This is the easiest way to test chat
without installing Ollama, but it needs a WebGPU-capable browser and enough
memory/VRAM.

The model field accepts any WebLLM model ID, for example
`Llama-3.2-1B-Instruct-q4f32_1-MLC` or
`Qwen2.5-1.5B-Instruct-q4f32_1-MLC`. Larger models need more GPU memory.
WebLLM is loaded on demand from `https://esm.run/@mlc-ai/web-llm`; it is not
used unless you select this provider.

### WebSocket agent protocol

Rune sends one JSON message after the socket opens:

```json
{
  "type": "chat",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Hello" }
  ],
  "model": "optional-model-name",
  "stream": true
}
```

The agent can reply with any of these JSON shapes:

```json
{ "delta": "partial text" }
{ "token": "partial text" }
{ "content": "partial text" }
{ "message": { "content": "partial text" } }
```

Finish with `{ "type": "done" }` or `{ "done": true }`. Plain text messages are
also accepted as chunks.

## What changed

- Added a full chat panel with streaming replies, stop, clear, and Markdown
  rendering.
- Added provider adapters for OpenAI-compatible servers, Ollama, Chrome's
  Prompt API, WebLLM (WebGPU), WebSocket agents, and an offline demo.
- Added automatic detection of common local AI ports and model discovery.
- Added a connection tester with useful CORS/model errors.
- Added browser speech recognition (dictation) and speech synthesis (optional
  spoken replies).
- Persisted provider settings in `localStorage`; conversation history stays in
  memory and is cleared on reload.
- Updated `agent.js` to report speech, streaming, and browser-AI capabilities.
- Kept the existing microphone meter and wake sound intact.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | HUD, layout, styles, microphone meter, boot sequence |
| `agent.js` | Capability checks and Rune version |
| `rune-chat.js` | Chat UI, provider adapters, detection, streaming, speech |
| `serve.sh` | Local static server helper |
| `fix_rune_v41.py` | Historical V4.1 boot-screen patch (not used at runtime) |

## Research notes: how people build local JARVIS-style assistants

The common pattern in current open-source JARVIS projects is not one giant
model. It is a small local stack:

1. **Speech-to-text** — Whisper, Parakeet, or the browser's SpeechRecognition.
2. **A local LLM** — Ollama, LM Studio, llama.cpp, or a browser model such as
   Gemini Nano / WebLLM.
3. **Streaming** — Server-Sent Events or WebSockets so words appear as they are
   generated instead of waiting for the whole answer.
4. **Text-to-speech** — Piper, Chatterbox, system voices, or the browser's
   speechSynthesis.
5. **Memory and tools** — a local database, knowledge graph, MCP servers, or
   simple function calls for files, apps, weather, and search.
6. **A wake word / VAD layer** — Porcupine, Silero VAD, or a simple amplitude
   gate.

Examples and references:

- [Jarvis — Local AI Voice Assistant](https://www.everydev.ai/tools/jarvis-ai-voice-assistant):
  Ollama inference, unlimited local memory, MCP tools, Whisper dictation,
  Piper TTS.
- [akshayaggarwal99/jarvis-ai-assistant](https://github.com/akshayaggarwal99/jarvis-ai-assistant):
  local Whisper/Parakeet transcription and Ollama models for AI post-processing.
- [JARVIS_AI](https://github.com/Konstantinos123456789/JARVIS_AI): knowledge
  graph memory, BERT intent/emotion detection, and computer vision.
- [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api): built-in
  Gemini Nano sessions, streaming, and initial prompts.
- [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md): native
  `/api/chat` streaming and OpenAI-compatible endpoints.
- [LM Studio local server](https://lmstudio.ai/docs/app/api): OpenAI-compatible
  local endpoints.

Rune follows the same shape but stays browser-first: the page is the UI and
orchestrator, and all model inference happens in a local process or in the
browser's built-in model.

## Privacy and security

- Rune sends requests only to the endpoint you configure. WebLLM is the one
  exception: selecting it loads the WebLLM runtime and model weights from their
  public hosts, then runs inference locally in the tab.
- The API key field is optional and is stored in `localStorage` on this origin.
  Do not use a valuable cloud key in a shared browser profile.
- Local AI servers often have no authentication. Keep them bound to
  `127.0.0.1`; do not expose them to your LAN or the internet.
- `OLLAMA_ORIGINS=*` is convenient for testing but allows any web origin to call
  your Ollama instance. Prefer the exact Rune origin when possible.
- Chat history is not persisted by Rune. Reloading the page clears it.

## Troubleshooting

**"Could not reach ..." / "Failed to fetch"**

The server is not running, the URL is wrong, or CORS is blocking the browser.
Start the server and allow Rune's origin. For Ollama use
`OLLAMA_ORIGINS=* ollama serve`; for LM Studio enable CORS in the server
settings.

**HTTP 404**

For an OpenAI-compatible server, check that the base URL ends in `/v1`. For
Ollama, choose the **Ollama** provider instead of **OpenAI-compatible**.

**Model not found**

Pull or load the model first. For Ollama:

```bash
ollama pull llama3.2
```

**Chrome built-in AI is unavailable**

Check `chrome://on-device-internals`, Chrome version, free disk space, and the
Prompt API hardware requirements. The model may still need to download.

**Speech recognition does not work**

Dictation uses the Web Speech API. Chrome and Edge generally support it;
Firefox support varies. Spoken replies use `speechSynthesis` and depend on the
voices installed on your system.
