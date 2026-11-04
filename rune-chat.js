/* RUNE V5: local chat mode.
 *
 * Provider adapters:
 *   - openai  : any OpenAI-compatible local server (LM Studio, llama.cpp,
 *               Jan, vLLM, KoboldCpp, LocalAI, text-generation-webui...)
 *   - ollama  : Ollama's native /api/chat endpoint
 *   - browser : Chrome's built-in Prompt API (Gemini Nano)
 *   - ws      : a custom real-time WebSocket agent
 *   - demo    : offline echo provider, so chat can be tested with no server
 *
 * Nothing is sent anywhere unless the configured endpoint points there.
 */

const STORAGE_KEY = "rune.chat.config.v1";
const MAX_HISTORY_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 14000;

const PROVIDER_PRESETS = {
    demo: {
        label: "Demo (offline test)",
        endpoint: "",
        model: "rune-demo",
        placeholder: "No server needed"
    },
    openai: {
        label: "OpenAI-compatible",
        endpoint: "http://localhost:1234/v1",
        model: "",
        placeholder: "http://localhost:1234/v1"
    },
    ollama: {
        label: "Ollama",
        endpoint: "http://localhost:11434",
        model: "llama3.2",
        placeholder: "http://localhost:11434"
    },
    browser: {
        label: "Chrome built-in AI",
        endpoint: "",
        model: "gemini-nano",
        placeholder: "Gemini Nano (in-browser)"
    },
    webllm: {
        label: "WebLLM (in-browser)",
        endpoint: "",
        model: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
        placeholder: "WebLLM model ID"
    },
    ws: {
        label: "WebSocket agent",
        endpoint: "ws://localhost:8765",
        model: "",
        placeholder: "ws://localhost:8765"
    }
};

const DEFAULT_CONFIG = {
    provider: "demo",
    endpoint: "",
    model: "rune-demo",
    apiKey: "",
    systemPrompt:
        "You are Rune, a concise, capable personal assistant running locally. " +
        "Answer clearly and directly. Prefer short paragraphs and useful steps. " +
        "Never claim to have taken an action you did not take.",
    temperature: 0.7,
    maxTokens: 512,
    stream: true,
    speak: false
};

/* Common local AI ports. The order is the detection priority. */
const LOCAL_PROBES = [
    { provider: "ollama", endpoint: "http://localhost:11434" },
    { provider: "openai", endpoint: "http://localhost:1234/v1" },
    { provider: "openai", endpoint: "http://localhost:8080/v1" },
    { provider: "openai", endpoint: "http://localhost:5000/v1" },
    { provider: "openai", endpoint: "http://localhost:1337/v1" },
    { provider: "openai", endpoint: "http://localhost:8000/v1" },
    { provider: "openai", endpoint: "http://localhost:5001/v1" },
    { provider: "ollama", endpoint: "http://127.0.0.1:11434" },
    { provider: "openai", endpoint: "http://127.0.0.1:1234/v1" }
];

const $ = id => document.getElementById(id);

let config = loadConfig();
let hadSavedConfig = false;
let messages = [];
let controller = null;
let generating = false;
let activeSession = null;
let recognition = null;
let userTouchedConfig = false;
let hooks = {};
let currentEngineState = "offline";

let webllmEngine = null;
let webllmModel = "";
let webllmLoading = null;

let els = {};

function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            hadSavedConfig = true;
            return { ...DEFAULT_CONFIG, ...saved };
        }
    } catch (error) {
        console.info("Rune chat config could not be read:", error);
    }

    return { ...DEFAULT_CONFIG };
}

function persistConfig() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
        console.info("Rune chat config could not be saved:", error);
    }
}

function log(message, type = "event") {
    if (typeof hooks.log === "function") {
        hooks.log(message, type);
    } else {
        console.log("[Rune chat]", message);
    }
}

function setCoreStatus(main, detail) {
    if (typeof hooks.setCoreStatus === "function") {
        hooks.setCoreStatus(main, detail);
    }
}

function setNote(text, type = "") {
    if (!els.settingsNote) return;
    els.settingsNote.textContent = text || "";
    els.settingsNote.className = "settings-note " + type;
}

function setHint(text) {
    if (els.hint) els.hint.textContent = text;
}

function setEngineState(state, detail = "") {
    const states = {
        connected: {
            text: "CONNECTED",
            cls: "green",
            badge: "AI CONNECTED"
        },
        connecting: {
            text: "CONNECTING",
            cls: "yellow",
            badge: "AI CONNECTING"
        },
        offline: {
            text: "NOT CONNECTED",
            cls: "yellow",
            badge: "AI NOT CONNECTED"
        },
        demo: {
            text: "DEMO MODE",
            cls: "yellow",
            badge: "DEMO MODE"
        },
        error: {
            text: "CONNECTION ERROR",
            cls: "red",
            badge: "AI ERROR"
        }
    };

    const info = states[state] || states.offline;
    currentEngineState = state;

    if (els.engineStatus) {
        els.engineStatus.textContent = "AI ENGINE: " + info.text;
        els.engineStatus.className = "chat-engine " + info.cls;
    }

    if (els.aiStatus) {
        els.aiStatus.textContent = info.text;
        els.aiStatus.className = "stat-value " + info.cls;
    }

    if (els.chatStatus) {
        els.chatStatus.textContent =
            state === "connected" ? "CONNECTED"
                : state === "demo" ? "DEMO"
                    : state === "connecting" ? "CONNECTING"
                        : state === "error" ? "ERROR"
                            : "READY";
        els.chatStatus.className = "stat-value " + info.cls;
    }

    if (els.systemBadge) {
        els.systemBadge.textContent = info.badge;
    }

    if (detail) setHint(detail);

    if (state === "connected") {
        setCoreStatus(
            "CHAT READY",
            "Connected to " + (config.model || config.provider)
        );
    } else if (state === "connecting") {
        setCoreStatus("THINKING", "Waiting for the local AI");
    } else if (state === "offline") {
        setCoreStatus("INTERFACE READY", "AI engine not connected");
    } else if (state === "demo") {
        setCoreStatus("DEMO MODE", "No local AI connected");
    }
}

function providerHint(provider) {
    switch (provider) {
        case "openai":
            return "Start LM Studio, llama.cpp, Jan, vLLM or another OpenAI-compatible server. The base URL usually ends in /v1. Enable CORS for this page if needed.";
        case "ollama":
            return "Start Ollama with `ollama serve`, pull a model, and use http://localhost:11434. Set OLLAMA_ORIGINS=* if the browser is blocked by CORS.";
        case "browser":
            return "Uses Chrome's built-in Prompt API (Gemini Nano). Chrome 138+ and compatible hardware are required. The model may download on first use.";
        case "webllm":
            return "Runs a model inside this tab with WebLLM and WebGPU. The first message downloads and caches model weights. Enter any WebLLM model ID.";
        case "ws":
            return "Custom real-time agent. Send {type:'chat', messages} and stream {delta} / {content} chunks, then {type:'done'}.";
        case "demo":
        default:
            return "Demo mode streams a local echo response. No AI server is needed, so you can test the chat interface immediately.";
    }
}

function refreshProviderUI() {
    const provider = els.provider.value;
    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.demo;
    const fixedEndpoint =
        provider === "demo" || provider === "browser" || provider === "webllm";
    const fixedModel = provider === "demo" || provider === "browser";

    els.endpoint.disabled = fixedEndpoint;
    els.model.disabled = fixedModel;
    els.apiKey.disabled = provider === "demo" || provider === "webllm";

    els.endpoint.placeholder = preset.placeholder;
    els.model.placeholder = preset.model || "model name";

    if (fixedEndpoint) {
        els.endpoint.value = preset.endpoint;
    } else if (!els.endpoint.value.trim() || isKnownEndpoint(els.endpoint.value)) {
        els.endpoint.value = preset.endpoint;
    }

    if (fixedModel) {
        els.model.value = preset.model;
    } else if (!els.model.value.trim() || isKnownModel(els.model.value)) {
        els.model.value = preset.model;
    }

    setHint(providerHint(provider));
}

function isKnownEndpoint(value) {
    const normalized = normalizeBase(value);
    return Object.values(PROVIDER_PRESETS).some(
        preset => preset.endpoint && normalizeBase(preset.endpoint) === normalized
    );
}

function isKnownModel(value) {
    return Object.values(PROVIDER_PRESETS).some(
        preset => preset.model && preset.model === value
    );
}

function readFormConfig() {
    const provider = els.provider.value;
    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.demo;
    const fixedEndpoint =
        provider === "demo" || provider === "browser" || provider === "webllm";
    const fixedModel = provider === "demo" || provider === "browser";

    return {
        provider,
        endpoint: fixedEndpoint
            ? preset.endpoint
            : els.endpoint.value.trim(),
        model: fixedModel
            ? preset.model
            : els.model.value.trim(),
        apiKey: provider === "demo" || provider === "webllm"
            ? ""
            : els.apiKey.value.trim(),
        systemPrompt: els.systemPrompt.value.trim(),
        temperature: clamp(Number(els.temperature.value), 0, 2, 0.7),
        maxTokens: Math.round(
            clamp(Number(els.maxTokens.value), 32, 8192, 512)
        ),
        stream: els.stream.checked,
        speak: els.speak.checked
    };
}

function applyConfigToForm() {
    els.provider.value = PROVIDER_PRESETS[config.provider]
        ? config.provider
        : "demo";
    els.endpoint.value = config.endpoint;
    els.model.value = config.model;
    els.apiKey.value = config.apiKey || "";
    els.systemPrompt.value = config.systemPrompt || "";
    els.temperature.value = config.temperature;
    els.maxTokens.value = config.maxTokens;
    els.stream.checked = config.stream !== false;
    els.speak.checked = Boolean(config.speak);
    refreshProviderUI();
}

function clamp(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function normalizeBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function apiRoot(endpoint) {
    let base = normalizeBase(endpoint);
    base = base.replace(/\/(chat\/completions|models)$/, "");
    if (/\/v1$/.test(base)) return base;
    return base + "/v1";
}

function openAIUrl(endpoint, path) {
    return apiRoot(endpoint) + "/" + path;
}

function ollamaUrl(endpoint, path) {
    let base = normalizeBase(endpoint);
    base = base.replace(/\/(api\/chat|api\/tags)$/, "");
    if (/\/api$/.test(base)) return base + "/" + path;
    return base + "/api/" + path;
}

function validateConfig(cfg) {
    if (cfg.provider === "demo" || cfg.provider === "browser") return;

    if (cfg.provider === "webllm") {
        if (!cfg.model) throw new Error("Set a WebLLM model ID in CONFIG first.");
        return;
    }

    if (!cfg.endpoint) {
        throw new Error("Set an endpoint in CONFIG first.");
    }

    if (cfg.provider === "ws") {
        if (!/^wss?:\/\//i.test(cfg.endpoint)) {
            throw new Error("WebSocket endpoints must start with ws:// or wss://.");
        }
        return;
    }

    if (!cfg.model) {
        throw new Error("Set a model name in CONFIG first.");
    }
}

function timeoutSignal(ms) {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
        return AbortSignal.timeout(ms);
    }

    const local = new AbortController();
    setTimeout(() => local.abort(), ms);
    return local.signal;
}

async function fetchJson(url, options = {}, timeoutMs = 2500) {
    const response = await fetch(url, {
        ...options,
        signal: options.signal || timeoutSignal(timeoutMs)
    });

    if (!response.ok) throw await httpError(response, url);
    return response.json();
}

async function httpError(response, url) {
    let body = "";

    try {
        body = await response.text();
    } catch (error) {
        /* The body may already be consumed or unavailable. */
    }

    const snippet = body
        ? " " + body.replace(/\s+/g, " ").slice(0, 300)
        : "";

    const error = new Error(
        "HTTP " + response.status + " from " + url + "." + snippet
    );
    error.status = response.status;
    return error;
}

function friendlyError(error, cfg) {
    if (!error) return "Unknown error.";
    if (error.name === "AbortError") return "Generation stopped.";

    const message = String(error.message || error);

    if (/model .* not found|model .* does not exist/i.test(message)) {
        return message + " Run: ollama pull " + (cfg.model || "MODEL");
    }

    if (error.status === 401 || error.status === 403) {
        return "The local server rejected the API key. Clear the key or check the server settings.";
    }

    if (error.status === 404) {
        return "Endpoint not found (" + (cfg.endpoint || "empty") + "). For OpenAI-compatible servers the base URL usually ends in /v1. For Ollama, choose the Ollama provider.";
    }

    if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
        return "Could not reach " + (cfg.endpoint || "the local AI") + ". Is the server running? If it is, enable CORS for this page. Ollama: OLLAMA_ORIGINS=* ollama serve. LM Studio: enable CORS in server settings.";
    }

    return message;
}

function extractModels(data) {
    const list = data?.data || data?.models || [];
    if (!Array.isArray(list)) return [];

    return list
        .map(item => {
            if (typeof item === "string") return item;
            return item?.id || item?.name || item?.model || "";
        })
        .filter(Boolean);
}

function populateModelList(models) {
    if (!els.modelList) return;
    els.modelList.innerHTML = "";

    models.forEach(model => {
        const option = document.createElement("option");
        option.value = model;
        els.modelList.appendChild(option);
    });
}

function buildRequestMessages(history) {
    const clean = history.filter(
        message => message && message.content && message.role
    );

    let selected = clean.slice(-MAX_HISTORY_MESSAGES);
    let total = selected.reduce(
        (sum, message) => sum + message.content.length,
        0
    );

    while (total > MAX_CONTEXT_CHARS && selected.length > 1) {
        total -= selected[0].content.length;
        selected = selected.slice(1);
    }

    const request = [];

    if (config.systemPrompt) {
        request.push({ role: "system", content: config.systemPrompt });
    }

    request.push(...selected);
    return request;
}

function textFromContent(content) {
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === "string") return part;
                return part?.text || part?.content || "";
            })
            .join("");
    }

    return "";
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------
 * Provider adapters
 * --------------------------------------------------------------- */

async function requestOpenAI(request, onDelta, signal) {
    const url = openAIUrl(config.endpoint, "chat/completions");

    const headers = {
        "Content-Type": "application/json"
    };

    if (config.apiKey) {
        headers.Authorization = "Bearer " + config.apiKey;
    }

    const body = {
        model: config.model,
        messages: request,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: Boolean(config.stream)
    };

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal
    });

    if (!response.ok) throw await httpError(response, url);

    if (!config.stream) {
        const data = await response.json();
        const text = textFromContent(
            data?.choices?.[0]?.message?.content ??
            data?.choices?.[0]?.text ??
            ""
        );

        if (text) onDelta(text);
        return text;
    }

    if (!response.body) {
        throw new Error("This server returned no streaming body. Turn off Stream tokens in CONFIG.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let done = false;

    while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });

        let newline = buffer.indexOf("\n");

        while (newline >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");

            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            const payload = trimmed.startsWith("data:")
                ? trimmed.slice(5).trim()
                : trimmed;

            if (payload === "[DONE]") {
                done = true;
                break;
            }

            try {
                const json = JSON.parse(payload);
                const delta = textFromContent(
                    json?.choices?.[0]?.delta?.content ??
                    json?.choices?.[0]?.message?.content ??
                    json?.choices?.[0]?.text ??
                    ""
                );

                if (delta) {
                    full += delta;
                    onDelta(delta);
                }
            } catch (error) {
                /* Some servers send keep-alive text that is not JSON. */
            }
        }
    }

    return full;
}

async function requestOllama(request, onDelta, signal) {
    const url = ollamaUrl(config.endpoint, "chat");

    const body = {
        model: config.model,
        messages: request,
        stream: Boolean(config.stream),
        options: {
            temperature: config.temperature,
            num_predict: config.maxTokens
        }
    };

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal
    });

    if (!response.ok) throw await httpError(response, url);

    if (!config.stream) {
        const data = await response.json();
        if (data?.error) throw new Error(data.error);

        const text = data?.message?.content ?? data?.response ?? "";
        if (text) onDelta(text);
        return text;
    }

    if (!response.body) {
        throw new Error("Ollama returned no streaming body. Turn off Stream tokens in CONFIG.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });

        let newline = buffer.indexOf("\n");

        while (newline >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");

            if (!line.trim()) continue;

            try {
                const json = JSON.parse(line);
                if (json.error) throw new Error(json.error);

                const delta = json?.message?.content ?? json?.response ?? "";
                if (delta) {
                    full += delta;
                    onDelta(delta);
                }
            } catch (error) {
                if (error instanceof SyntaxError) continue;
                throw error;
            }
        }
    }

    return full;
}

function getBrowserAI() {
    if (globalThis.LanguageModel) return globalThis.LanguageModel;

    const legacy = globalThis.ai?.languageModel;
    if (!legacy) return null;

    return {
        availability: async () => {
            if (typeof legacy.capabilities !== "function") return "available";

            const capabilities = await legacy.capabilities();
            if (capabilities.available === "no") return "unavailable";
            if (capabilities.available === "after-download") return "downloadable";
            return "available";
        },
        create: options => legacy.create(options)
    };
}

async function browserAvailability(api) {
    const options = {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }]
    };

    try {
        return await api.availability(options);
    } catch (error) {
        return api.availability();
    }
}

async function requestBrowser(request, onDelta, signal) {
    const api = getBrowserAI();

    if (!api) {
        throw new Error(
            "Chrome's built-in AI is not available. Use Chrome 138+ on supported hardware, or choose another provider."
        );
    }

    const availability = await browserAvailability(api);

    if (availability === "unavailable") {
        throw new Error(
            "Chrome's built-in model is unavailable on this device. Check chrome://on-device-internals and the Prompt API requirements."
        );
    }

    if (availability === "downloadable" || availability === "downloading") {
        log("Chrome is downloading the built-in AI model. This can take a while.", "warn");
        setNote("Gemini Nano is downloading. First use may be slow.", "yellow");
    }

    const history = request.filter(message => message.role !== "system");
    const system = request.find(message => message.role === "system");
    const last = history[history.length - 1];

    if (!last) throw new Error("There is no user message to send.");

    const initialPrompts = [];
    if (system?.content) {
        initialPrompts.push({ role: "system", content: system.content });
    }
    initialPrompts.push(
        ...history.slice(0, -1).map(message => ({
            role: message.role,
            content: message.content
        }))
    );

    const session = await api.create({ initialPrompts, signal });
    activeSession = session;

    try {
        if (config.stream && typeof session.promptStreaming === "function") {
            const stream = session.promptStreaming(last.content, { signal });
            let previous = "";
            let full = "";

            for await (const chunk of stream) {
                const piece = String(chunk);

                /* Some implementations stream the full text so far,
                   others stream only the newest delta. Support both. */
                let delta;

                if (piece.startsWith(previous)) {
                    delta = piece.slice(previous.length);
                    previous = piece;
                    full = piece;
                } else {
                    delta = piece;
                    previous += piece;
                    full += piece;
                }

                if (delta) onDelta(delta);
            }

            return full;
        }

        const text = await session.prompt(last.content, { signal });
        if (text) onDelta(text);
        return text;
    } finally {
        try {
            session.destroy();
        } catch (error) {
            /* The session may already be gone. */
        }
        activeSession = null;
    }
}

async function getWebLLMEngine(model) {
    if (webllmEngine && webllmModel === model) return webllmEngine;
    if (webllmLoading && webllmModel === model) return webllmLoading;

    if (webllmEngine && webllmModel !== model) {
        try {
            await webllmEngine.unload();
        } catch (error) {
            /* The old engine may already be gone. */
        }
        webllmEngine = null;
    }

    webllmModel = model;

    webllmLoading = (async () => {
        const module = await import("https://esm.run/@mlc-ai/web-llm");
        const engine = await module.CreateMLCEngine(model, {
            initProgressCallback: report => {
                const text = report?.text || "Loading WebLLM model...";
                setNote(text, "yellow");
                setHint(text);
            }
        });

        webllmEngine = engine;
        return engine;
    })();

    try {
        return await webllmLoading;
    } catch (error) {
        webllmLoading = null;
        webllmModel = "";
        throw error;
    }
}

async function requestWebLLM(request, onDelta, signal) {
    if (!navigator.gpu) {
        throw new Error(
            "WebLLM needs WebGPU. Use Chrome or Edge with WebGPU enabled, or choose another provider."
        );
    }

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
        throw new Error(
            "WebGPU is present but no GPU adapter is available. Try another provider."
        );
    }

    const engine = await getWebLLMEngine(config.model);

    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }

    const stream = await engine.chat.completions.create({
        messages: request,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true
    });

    let full = "";

    for await (const chunk of stream) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }

        const delta = chunk?.choices?.[0]?.delta?.content || "";

        if (delta) {
            full += delta;
            onDelta(delta);
        }
    }

    return full;
}

function requestWebSocket(request, onDelta, signal) {
    return new Promise((resolve, reject) => {
        const url = config.endpoint;
        const socket = new WebSocket(url);

        let full = "";
        let settled = false;
        let timer = null;

        const finish = error => {
            if (settled) return;
            settled = true;

            if (timer) clearTimeout(timer);

            try {
                socket.close();
            } catch (closeError) {
                /* Already closed. */
            }

            if (error) reject(error);
            else resolve(full);
        };

        if (signal) {
            if (signal.aborted) {
                finish(new DOMException("Aborted", "AbortError"));
                return;
            }

            signal.addEventListener("abort", () => {
                finish(new DOMException("Aborted", "AbortError"));
            }, { once: true });
        }

        timer = setTimeout(() => {
            finish(new Error("WebSocket connection timed out."));
        }, 15000);

        socket.onopen = () => {
            if (timer) clearTimeout(timer);

            socket.send(JSON.stringify({
                type: "chat",
                messages: request,
                model: config.model,
                stream: true
            }));
        };

        socket.onmessage = event => {
            if (typeof event.data !== "string") return;

            let data = null;

            try {
                data = JSON.parse(event.data);
            } catch (error) {
                /* Plain text chunks are allowed. */
            }

            if (data && (data.type === "done" || data.done === true)) {
                finish();
                return;
            }

            if (data && (data.type === "error" || data.error)) {
                finish(new Error(data.error || data.message || "WebSocket agent error."));
                return;
            }

            const piece = data
                ? (data.delta ?? data.token ?? data.content ??
                   data.message?.content ?? data.response ?? "")
                : event.data;

            if (piece) {
                const text = String(piece);
                full += text;
                onDelta(text);
            }
        };

        socket.onerror = () => {
            finish(new Error(
                "WebSocket error. Is the agent running at " + url + "?"
            ));
        };

        socket.onclose = () => {
            finish();
        };
    });
}

async function requestDemo(request, onDelta, signal) {
    const lastUser = [...request]
        .reverse()
        .find(message => message.role === "user");

    const prompt = lastUser?.content || "(empty)";

    const text =
        "Demo mode is active, so no language model is running yet.\n\n" +
        "I received: \"" + prompt + "\"\n\n" +
        "Open CONFIG above, choose a provider, then press DETECT LOCAL AI " +
        "or TEST. Rune works with Ollama, LM Studio, llama.cpp, Jan, vLLM, " +
        "KoboldCpp, Chrome's built-in AI, and any OpenAI-compatible server.";

    const chunks = text.match(/\S+\s*/g) || [text];

    for (const chunk of chunks) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }

        onDelta(chunk);
        await sleep(16);
    }

    return text;
}

async function requestReply(request, onDelta, signal) {
    switch (config.provider) {
        case "ollama":
            return requestOllama(request, onDelta, signal);
        case "browser":
            return requestBrowser(request, onDelta, signal);
        case "webllm":
            return requestWebLLM(request, onDelta, signal);
        case "ws":
            return requestWebSocket(request, onDelta, signal);
        case "demo":
            return requestDemo(request, onDelta, signal);
        case "openai":
        default:
            return requestOpenAI(request, onDelta, signal);
    }
}

/* ---------------------------------------------------------------
 * Connection detection and testing
 * --------------------------------------------------------------- */

async function probeEndpoint(entry) {
    try {
        if (entry.provider === "ollama") {
            const data = await fetchJson(
                ollamaUrl(entry.endpoint, "tags"),
                {},
                1600
            );

            return {
                ...entry,
                models: extractModels(data)
            };
        }

        const data = await fetchJson(
            openAIUrl(entry.endpoint, "models"),
            {},
            1600
        );

        return {
            ...entry,
            models: extractModels(data)
        };
    } catch (error) {
        return null;
    }
}

async function detectLocalAI(options = {}) {
    const silent = Boolean(options.silent);

    if (!silent) {
        setNote("Scanning common local AI ports...", "yellow");
        setEngineState("connecting", "Scanning local ports for an AI server...");
        log("Scanning common local AI endpoints.", "event");
    }

    const results = await Promise.all(LOCAL_PROBES.map(probeEndpoint));
    const found = results.find(Boolean);

    if (found) {
        const detectedModel =
            found.models[0] || PROVIDER_PRESETS[found.provider].model;

        els.provider.value = found.provider;
        els.endpoint.value = found.endpoint;
        els.model.value = detectedModel;
        refreshProviderUI();
        populateModelList(found.models);

        config = readFormConfig();
        persistConfig();

        if (found.provider === "openai" && !detectedModel) {
            setEngineState(
                "offline",
                "Detected an OpenAI-compatible server at " +
                found.endpoint +
                ". Enter its model name, then press TEST."
            );
            setNote("Server found. Enter the model name.", "yellow");
        } else {
            setEngineState(
                "connected",
                "Detected " + PROVIDER_PRESETS[found.provider].label +
                " at " + found.endpoint +
                (found.models.length ? " (" + found.models.length + " model" + (found.models.length === 1 ? "" : "s") + ")" : "")
            );
            setNote("Detected " + (detectedModel || "server") + ".", "green");
        }

        if (!silent) {
            log(
                "Detected local AI: " + found.provider + " at " + found.endpoint +
                (found.models.length ? " — models: " + found.models.join(", ") : ""),
                "ok"
            );
        }

        return true;
    }

    const api = getBrowserAI();

    if (api) {
        try {
            const availability = await browserAvailability(api);

            if (availability !== "unavailable") {
                els.provider.value = "browser";
                els.model.value = "gemini-nano";
                refreshProviderUI();

                config = readFormConfig();
                persistConfig();

                setEngineState(
                    "connected",
                    "Using Chrome's built-in AI (" + availability + ")."
                );
                setNote("Chrome built-in AI is available.", "green");

                if (!silent) {
                    log("Detected Chrome built-in AI: " + availability, "ok");
                }

                return true;
            }
        } catch (error) {
            /* Fall through to the offline message. */
        }
    }

    if (!silent) {
        setEngineState(
            "offline",
            "No local AI found. Start Ollama, LM Studio, llama.cpp or another server, then press DETECT again."
        );
        setNote("No local AI found. Demo mode still works.", "yellow");
        log("No local AI detected on the common ports.", "warn");
    }

    return false;
}

async function testOpenAI(cfg) {
    const modelsUrl = openAIUrl(cfg.endpoint, "models");

    try {
        const data = await fetchJson(modelsUrl, {}, 3000);
        return extractModels(data);
    } catch (error) {
        if (error.status !== 404) throw error;

        /* Some compatible servers do not expose /models.
           Fall back to a one-token chat request. */
        const url = openAIUrl(cfg.endpoint, "chat/completions");
        const headers = { "Content-Type": "application/json" };

        if (cfg.apiKey) {
            headers.Authorization = "Bearer " + cfg.apiKey;
        }

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: cfg.model,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1,
                stream: false
            }),
            signal: timeoutSignal(5000)
        });

        if (!response.ok) throw await httpError(response, url);
        return [];
    }
}

async function testOllama(cfg) {
    const data = await fetchJson(
        ollamaUrl(cfg.endpoint, "tags"),
        {},
        3000
    );

    const models = extractModels(data);

    if (cfg.model && models.length) {
        const matches = models.some(
            model => model === cfg.model || model.startsWith(cfg.model + ":")
        );

        if (!matches) {
            throw new Error(
                "Ollama is running, but model \"" + cfg.model +
                "\" is not installed. Available: " + models.join(", ") +
                ". Run: ollama pull " + cfg.model
            );
        }
    }

    return models;
}

async function testBrowser() {
    const api = getBrowserAI();

    if (!api) {
        throw new Error(
            "Chrome's built-in AI is not available. Use Chrome 138+ on supported hardware."
        );
    }

    const availability = await browserAvailability(api);

    if (availability === "unavailable") {
        throw new Error(
            "Chrome's built-in model is unavailable on this device."
        );
    }

    return availability;
}

function testWebSocket(cfg) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(cfg.endpoint);
        let settled = false;

        const finish = error => {
            if (settled) return;
            settled = true;

            try {
                socket.close();
            } catch (closeError) {
                /* Already closed. */
            }

            if (error) reject(error);
            else resolve();
        };

        const timer = setTimeout(() => {
            finish(new Error("WebSocket connection timed out."));
        }, 4000);

        socket.onopen = () => {
            clearTimeout(timer);
            finish();
        };

        socket.onerror = () => {
            clearTimeout(timer);
            finish(new Error(
                "Could not open " + cfg.endpoint +
                ". Is the WebSocket agent running?"
            ));
        };

        socket.onclose = () => {
            clearTimeout(timer);
            finish();
        };
    });
}

async function testConnection(options = {}) {
    const silent = Boolean(options.silent);
    let cfg;

    try {
        cfg = readFormConfig();
        validateConfig(cfg);
    } catch (error) {
        setEngineState("error", error.message);
        setNote(error.message, "red");
        if (!silent) log(error.message, "error");
        return false;
    }

    if (!silent) {
        setEngineState("connecting", "Testing " + (cfg.endpoint || cfg.provider) + "...");
        setNote("Testing connection...", "yellow");
        log("Testing AI connection: " + cfg.provider + " " + (cfg.endpoint || ""), "event");
    }

    try {
        let models = [];
        let detail = "";

        if (cfg.provider === "demo") {
            detail = "Demo mode is ready. No server required.";
        } else if (cfg.provider === "openai") {
            models = await testOpenAI(cfg);
            detail = "Connected to " + cfg.endpoint +
                (models.length ? " — " + models.length + " model(s) available." : ".");
        } else if (cfg.provider === "ollama") {
            models = await testOllama(cfg);
            detail = "Connected to Ollama at " + cfg.endpoint +
                (models.length ? " — models: " + models.join(", ") : ".");
        } else if (cfg.provider === "browser") {
            const availability = await testBrowser();
            detail = "Chrome built-in AI is " + availability + ".";
        } else if (cfg.provider === "webllm") {
            if (!navigator.gpu) {
                throw new Error(
                    "WebLLM needs WebGPU. Use Chrome or Edge with WebGPU enabled."
                );
            }

            const adapter = await navigator.gpu.requestAdapter();

            if (!adapter) {
                throw new Error(
                    "WebGPU is present but no GPU adapter is available."
                );
            }

            detail = "WebGPU is available. The WebLLM model loads on the first message.";
        } else if (cfg.provider === "ws") {
            await testWebSocket(cfg);
            detail = "WebSocket agent reachable at " + cfg.endpoint + ".";
        }

        config = cfg;
        persistConfig();
        populateModelList(models);

        if (cfg.provider === "demo") {
            setEngineState("demo", detail);
        } else {
            setEngineState("connected", detail);
        }

        setNote(detail, "green");

        if (!silent) log(detail, "ok");
        return true;
    } catch (error) {
        const message = friendlyError(error, cfg);

        setEngineState("error", message);
        setNote(message, "red");

        if (!silent) log("AI connection failed: " + message, "error");
        return false;
    }
}

/* ---------------------------------------------------------------
 * Rendering
 * --------------------------------------------------------------- */

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[character]));
}

function renderMarkdown(value) {
    let html = escapeHtml(value);

    html = html.replace(
        /```([^\n`]*)\n([\s\S]*?)```/g,
        (match, language, code) =>
            "<pre class=\"code\"><code>" +
            code.replace(/\n$/, "") +
            "</code></pre>"
    );

    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(
        /(^|[^*])\*([^*\n]+)\*/g,
        "$1<em>$2</em>"
    );
    html = html.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        "<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>"
    );
    html = html.replace(/^### (.+)$/gm, "<span class=\"md-h3\">$1</span>");
    html = html.replace(/^## (.+)$/gm, "<span class=\"md-h2\">$1</span>");

    return html;
}

function isNearBottom() {
    if (!els.chatLog) return true;
    return els.chatLog.scrollHeight - els.chatLog.scrollTop - els.chatLog.clientHeight < 80;
}

function scrollChat(force = false) {
    if (!els.chatLog) return;
    if (force || isNearBottom()) {
        els.chatLog.scrollTop = els.chatLog.scrollHeight;
    }
}

function createMessageElement(message, streaming = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "msg " + message.role;

    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent =
        message.role === "user"
            ? "YOU"
            : message.role === "assistant"
                ? "RUNE"
                : "SYSTEM";

    const body = document.createElement("div");
    body.className = "msg-body" + (streaming ? " streaming" : "");

    if (streaming) {
        body.textContent = message.content;
    } else {
        body.innerHTML = renderMarkdown(message.content);
    }

    wrapper.append(label, body);
    return { wrapper, body };
}

function appendNotice(text) {
    if (!els.chatLog) return;

    const message = { role: "system", content: text };
    const { wrapper } = createMessageElement(message, false);
    els.chatLog.appendChild(wrapper);
    scrollChat(true);
}

function clearChat() {
    if (generating) stopGeneration();

    messages = [];
    activeSession = null;

    if (els.chatLog) els.chatLog.innerHTML = "";

    appendNotice(
        "Chat cleared. Configure a local AI above, or use Demo mode to test the interface."
    );

    log("Chat history cleared.", "warn");
}

function autoResizeInput() {
    if (!els.input) return;

    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + "px";
}

function setGenerating(value) {
    generating = value;

    if (els.send) els.send.disabled = value;
    if (els.stop) els.stop.hidden = !value;

    if (els.systemBadge) {
        if (value) {
            els.systemBadge.textContent = "AI THINKING";
        } else if (currentEngineState === "connected") {
            els.systemBadge.textContent = "AI CONNECTED";
        } else if (currentEngineState === "demo") {
            els.systemBadge.textContent = "DEMO MODE";
        } else if (currentEngineState === "error") {
            els.systemBadge.textContent = "AI ERROR";
        } else {
            els.systemBadge.textContent = "AI NOT CONNECTED";
        }
    }
}

function stopGeneration() {
    if (controller) {
        controller.abort();
    }

    if (activeSession) {
        try {
            activeSession.destroy();
        } catch (error) {
            /* Session already gone. */
        }
        activeSession = null;
    }

    log("Generation stopped.", "warn");
}

function speakReply(text) {
    if (!config.speak) return;
    if (!("speechSynthesis" in window)) {
        log("Speech synthesis is not available in this browser.", "warn");
        return;
    }

    const clean = String(text)
        .replace(/```[\s\S]*?```/g, " code block ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[#*_`>]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!clean) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 1600));
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
}

async function sendMessage(text) {
    if (generating) return;

    const content = String(text || "").trim();
    if (!content) return;

    if (els.input) {
        els.input.value = "";
        autoResizeInput();
    }

    messages.push({ role: "user", content });

    const userElement = createMessageElement({ role: "user", content }, false);
    els.chatLog.appendChild(userElement.wrapper);
    scrollChat(true);

    const request = buildRequestMessages(messages);

    const assistant = { role: "assistant", content: "" };
    messages.push(assistant);

    const assistantElement = createMessageElement(assistant, true);
    els.chatLog.appendChild(assistantElement.wrapper);
    scrollChat(true);

    controller = new AbortController();
    setGenerating(true);

    try {
        await requestReply(
            request,
            delta => {
                assistant.content += delta;
                assistantElement.body.textContent = assistant.content;
                scrollChat();
            },
            controller.signal
        );

        assistantElement.body.classList.remove("streaming");
        assistantElement.body.innerHTML = renderMarkdown(assistant.content);
        scrollChat();

        if (assistant.content) {
            speakReply(assistant.content);
        }

        if (config.provider === "demo") {
            setEngineState("demo", "Demo mode streams a local echo response. No AI server is needed.");
        } else {
            setEngineState(
                "connected",
                "Connected to " + (config.model || config.provider) + "."
            );
        }

        log("Reply received from " + config.provider + ".", "ok");
    } catch (error) {
        assistantElement.body.classList.remove("streaming");

        if (error.name === "AbortError") {
            if (assistant.content) {
                assistantElement.body.innerHTML = renderMarkdown(assistant.content);
                appendNotice("Generation stopped. Partial reply kept.");
            } else {
                assistantElement.wrapper.remove();
                messages = messages.filter(message => message !== assistant);
                appendNotice("Generation stopped.");
            }
        } else {
            const message = friendlyError(error, config);

            if (assistant.content) {
                assistantElement.body.innerHTML = renderMarkdown(assistant.content);
            } else {
                assistantElement.wrapper.remove();
                messages = messages.filter(item => item !== assistant);
            }

            appendNotice("AI error: " + message);
            setEngineState("error", message);
            log("AI request failed: " + message, "error");
        }
    } finally {
        controller = null;
        setGenerating(false);
    }
}

/* ---------------------------------------------------------------
 * Speech input
 * --------------------------------------------------------------- */

function toggleDictation() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
        log("Speech recognition is not available in this browser. Chrome or Edge is recommended.", "warn");
        setNote("Speech recognition is not supported here.", "yellow");
        return;
    }

    if (recognition) {
        recognition.stop();
        return;
    }

    recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    const base = els.input.value.trim();
    let finalText = base ? base + " " : "";

    els.dictate.textContent = "LISTENING...";
    els.dictate.classList.add("active");

    recognition.onresult = event => {
        let interim = "";

        for (let index = event.resultIndex; index < event.results.length; index++) {
            const transcript = event.results[index][0].transcript;

            if (event.results[index].isFinal) {
                finalText += transcript;
            } else {
                interim += transcript;
            }
        }

        els.input.value = (finalText + interim).trim();
        autoResizeInput();
    };

    recognition.onerror = event => {
        log("Dictation error: " + event.error, "warn");
    };

    recognition.onend = () => {
        recognition = null;
        els.dictate.textContent = "DICTATE";
        els.dictate.classList.remove("active");
        els.input.focus();
    };

    try {
        recognition.start();
        log("Dictation started.", "event");
    } catch (error) {
        recognition = null;
        els.dictate.textContent = "DICTATE";
        els.dictate.classList.remove("active");
        log("Dictation could not start: " + error.message, "error");
    }
}

/* ---------------------------------------------------------------
 * Initialization
 * --------------------------------------------------------------- */

function cacheElements() {
    els = {
        panel: $("chatPanel"),
        log: $("chatLog"),
        chatLog: $("chatLog"),
        form: $("chatForm"),
        input: $("chatInput"),
        send: $("chatSend"),
        stop: $("chatStop"),
        dictate: $("chatDictate"),
        clear: $("chatClear"),
        openChat: $("openChat"),
        settings: $("chatSettings"),
        settingsNote: $("chatSettingsNote"),
        provider: $("chatProvider"),
        endpoint: $("chatEndpoint"),
        model: $("chatModel"),
        modelList: $("chatModelList"),
        apiKey: $("chatApiKey"),
        systemPrompt: $("chatSystemPrompt"),
        temperature: $("chatTemperature"),
        maxTokens: $("chatMaxTokens"),
        stream: $("chatStream"),
        speak: $("chatSpeak"),
        save: $("chatSave"),
        test: $("chatTest"),
        detect: $("chatDetect"),
        engineStatus: $("chatEngineStatus"),
        hint: $("chatHint"),
        aiStatus: $("aiStatus"),
        chatStatus: $("chatStatus"),
        systemBadge: $("systemBadge")
    };
}

function bindEvents() {
    els.form.addEventListener("submit", event => {
        event.preventDefault();
        sendMessage(els.input.value);
    });

    els.input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            els.form.requestSubmit();
        }
    });

    els.input.addEventListener("input", autoResizeInput);
    els.stop.addEventListener("click", stopGeneration);
    els.clear.addEventListener("click", clearChat);
    els.dictate.addEventListener("click", toggleDictation);

    if (els.openChat) {
        els.openChat.addEventListener("click", () => {
            els.panel.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
            els.input.focus({ preventScroll: true });
        });
    }

    els.provider.addEventListener("change", () => {
        userTouchedConfig = true;
        refreshProviderUI();

        if (els.provider.value === "demo") {
            setEngineState("demo", "Demo mode is ready. No server needed.");
            setNote("Demo mode active. No server needed.", "yellow");
        } else {
            setEngineState(
                "offline",
                "Press TEST to connect, or DETECT to scan local ports."
            );
            setNote("Provider changed. Press TEST to verify.", "");
        }
    });

    [
        els.endpoint,
        els.model,
        els.apiKey,
        els.systemPrompt,
        els.temperature,
        els.maxTokens,
        els.stream,
        els.speak
    ].forEach(element => {
        element.addEventListener("input", () => {
            userTouchedConfig = true;
        });
        element.addEventListener("change", () => {
            userTouchedConfig = true;
        });
    });

    els.save.addEventListener("click", () => {
        try {
            const next = readFormConfig();
            validateConfig(next);

            config = next;
            persistConfig();

            setNote("Settings saved.", "green");
            log("Chat settings saved.", "ok");

            if (config.provider === "demo") {
                setEngineState("demo", "Demo mode is ready.");
            } else {
                setEngineState("offline", "Settings saved. Press TEST to connect.");
            }
        } catch (error) {
            setNote(error.message, "red");
            log(error.message, "warn");
        }
    });

    els.test.addEventListener("click", () => testConnection());
    els.detect.addEventListener("click", () => detectLocalAI());

    els.settings.addEventListener("toggle", () => {
        els.settings.setAttribute(
            "aria-label",
            els.settings.open ? "Chat configuration open" : "Chat configuration closed"
        );
    });
}

export function initializeChat(hookOptions = {}) {
    hooks = hookOptions || {};
    cacheElements();

    if (!els.panel || !els.form) {
        console.warn("Rune chat markup is missing; chat mode was not started.");
        return null;
    }

    bindEvents();
    applyConfigToForm();
    clearChat();

    if (config.provider === "demo") {
        setEngineState("demo", "Demo mode is ready. Configure a local AI above.");
        setNote("Demo mode active. No server needed.", "yellow");
    } else {
        setEngineState("offline", "Saved settings loaded. Press TEST to connect.");
        setNote("Saved settings loaded.", "");
    }

    if (!hadSavedConfig) {
        setTimeout(() => {
            if (!userTouchedConfig && !generating) {
                detectLocalAI({ silent: true });
            }
        }, 700);
    } else if (config.provider !== "demo") {
        setTimeout(() => {
            if (!userTouchedConfig && !generating) {
                testConnection({ silent: true });
            }
        }, 900);
    }

    log("Chat module initialized. Providers: OpenAI-compatible, Ollama, Chrome AI, WebLLM, WebSocket, Demo.", "ok");

    globalThis.RUNE_CHAT = {
        config: () => ({ ...config }),
        send: sendMessage,
        clear: clearChat,
        detect: detectLocalAI,
        test: testConnection,
        stop: stopGeneration
    };

    return globalThis.RUNE_CHAT;
}
