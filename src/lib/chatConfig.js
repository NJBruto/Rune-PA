/* Shared chat configuration, presets, and small helpers. */

export const STORAGE_KEY = "rune.chat.config.v1";
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_CONTEXT_CHARS = 14000;

export const PROVIDER_PRESETS = {
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
        model: "qwen3:1.7b",
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

export const DEFAULT_CONFIG = {
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
    speak: false,
    think: false
};

export function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        }
    } catch (error) {
        console.info("Rune chat config could not be read:", error);
    }

    return { ...DEFAULT_CONFIG };
}

export function persistConfig(config) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
        console.info("Rune chat config could not be saved:", error);
    }
}

export function hasSavedConfig() {
    try {
        return Boolean(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
        return false;
    }
}

export function clamp(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

export function normalizeBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

export function apiRoot(endpoint) {
    let base = normalizeBase(endpoint).replace(
        /\/(chat\/completions|models)$/,
        ""
    );
    if (/\/v1$/.test(base)) return base;
    return base + "/v1";
}

export function openAIUrl(endpoint, path) {
    return apiRoot(endpoint) + "/" + path;
}

export function ollamaUrl(endpoint, path) {
    let base = normalizeBase(endpoint);
    base = base.replace(/\/(api\/chat|api\/tags)$/, "");
    if (/\/api$/.test(base)) return base + "/" + path;
    return base + "/api/" + path;
}

export function isKnownEndpoint(value) {
    const normalized = normalizeBase(value);
    return Object.values(PROVIDER_PRESETS).some(
        preset =>
            preset.endpoint &&
            normalizeBase(preset.endpoint) === normalized
    );
}

export function isKnownModel(value) {
    return Object.values(PROVIDER_PRESETS).some(
        preset => preset.model && preset.model === value
    );
}

export function validateConfig(config) {
    if (config.provider === "demo" || config.provider === "browser") return;

    if (config.provider === "webllm") {
        if (!config.model) {
            throw new Error("Set a WebLLM model ID in CONFIG first.");
        }
        return;
    }

    if (!config.endpoint) {
        throw new Error("Set an endpoint in CONFIG first.");
    }

    if (config.provider === "ws") {
        if (!/^wss?:\/\//i.test(config.endpoint)) {
            throw new Error(
                "WebSocket endpoints must start with ws:// or wss://."
            );
        }
        return;
    }

    if (!config.model) {
        throw new Error("Set a model name in CONFIG first.");
    }
}

export function providerHint(provider) {
    switch (provider) {
        case "openai":
            return "The Node backend proxies this server, so CORS is not an issue. Base URL usually ends in /v1. Works with LM Studio, llama.cpp, Jan, vLLM, KoboldCpp and LocalAI.";
        case "ollama":
            return "The Node backend proxies Ollama, so CORS is not an issue. Run `ollama serve` and `ollama pull qwen3:1.7b` first.";
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

export function buildRequestMessages(config, history) {
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

export function textFromContent(content) {
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

export function extractModels(data) {
    const list = data?.data || data?.models || [];
    if (!Array.isArray(list)) return [];

    return list
        .map(item => {
            if (typeof item === "string") return item;
            return item?.id || item?.name || item?.model || "";
        })
        .filter(Boolean);
}

export function friendlyError(error, config) {
    if (!error) return "Unknown error.";
    if (error.name === "AbortError") return "Generation stopped.";

    const message = String(error.message || error);

    if (/model .* not found|model .* does not exist/i.test(message)) {
        return message + " Run: ollama pull " + (config.model || "MODEL");
    }

    if (error.status === 401 || error.status === 403) {
        return "The local server rejected the API key. Clear the key or check the server settings.";
    }

    if (error.status === 404) {
        return "Endpoint not found (" + (config.endpoint || "empty") +
            "). For OpenAI-compatible servers the base URL usually ends in /v1. For Ollama, choose the Ollama provider.";
    }

    if (
        error instanceof TypeError ||
        /failed to fetch|networkerror|load failed/i.test(message)
    ) {
        return "Could not reach " + (config.endpoint || "the local AI") +
            ". Is the server running? The Node backend proxies requests, so check the server log too.";
    }

    return message;
}

export function timestamp() {
    return new Date().toLocaleTimeString([], { hour12: false });
}
