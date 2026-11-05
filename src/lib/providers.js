/* Provider adapters.
 *
 * OpenAI-compatible and Ollama requests go through the Node backend, so
 * there is no browser CORS problem. Chrome AI, WebLLM, WebSocket and Demo
 * run directly in the browser.
 */

import { textFromContent } from "./chatConfig.js";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readSSE(response, onDelta) {
    if (!response.body) {
        throw new Error("The server returned no streaming body.");
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

            const trimmed = line.trim();
            if (!trimmed) continue;

            const payload = trimmed.startsWith("data:")
                ? trimmed.slice(5).trim()
                : trimmed;

            if (payload === "[DONE]") return full;

            try {
                const json = JSON.parse(payload);

                if (json.error) throw new Error(json.error);

                const delta = json.delta || "";

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

async function serverError(response) {
    let data = null;

    try {
        data = await response.json();
    } catch (error) {
        /* Non-JSON error body. */
    }

    const error = new Error(
        data?.error || "HTTP " + response.status + " from the Rune backend."
    );
    error.status = response.status;
    return error;
}

async function proxyChat(config, provider, request, onDelta, signal) {
    const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            provider,
            endpoint: config.endpoint,
            model: config.model,
            apiKey: config.apiKey,
            messages: request,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            stream: Boolean(config.stream),
            think: Boolean(config.think)
        }),
        signal
    });

    if (!response.ok) throw await serverError(response);

    if (!config.stream) {
        const data = await response.json();
        const text = data?.text || "";
        if (text) onDelta(text);
        return text;
    }

    return readSSE(response, onDelta);
}

export function requestOpenAI(config, request, onDelta, signal) {
    return proxyChat(config, "openai", request, onDelta, signal);
}

export function requestOllama(config, request, onDelta, signal) {
    return proxyChat(config, "ollama", request, onDelta, signal);
}

/* ---------------------------------------------------------------
 * Chrome built-in AI
 * --------------------------------------------------------------- */

function getBrowserAI() {
    if (globalThis.LanguageModel) return globalThis.LanguageModel;

    const legacy = globalThis.ai?.languageModel;
    if (!legacy) return null;

    return {
        availability: async () => {
            if (typeof legacy.capabilities !== "function") return "available";

            const capabilities = await legacy.capabilities();
            if (capabilities.available === "no") return "unavailable";
            if (capabilities.available === "after-download") {
                return "downloadable";
            }
            return "available";
        },
        create: options => legacy.create(options)
    };
}

export async function browserAvailability(api) {
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

export async function requestBrowser(
    config,
    request,
    onDelta,
    signal,
    hooks
) {
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
        hooks?.log?.(
            "Chrome is downloading the built-in AI model. This can take a while.",
            "warn"
        );
        hooks?.setNote?.(
            "Gemini Nano is downloading. First use may be slow.",
            "yellow"
        );
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
    }
}

/* ---------------------------------------------------------------
 * WebLLM
 * --------------------------------------------------------------- */

let webllmEngine = null;
let webllmModel = "";
let webllmLoading = null;

async function getWebLLMEngine(model, hooks) {
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
                hooks?.setNote?.(text, "yellow");
                hooks?.setHint?.(text);
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

export async function requestWebLLM(
    config,
    request,
    onDelta,
    signal,
    hooks
) {
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

    const engine = await getWebLLMEngine(config.model, hooks);

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

/* ---------------------------------------------------------------
 * WebSocket agent
 * --------------------------------------------------------------- */

export function requestWebSocket(config, request, onDelta, signal) {
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

            signal.addEventListener(
                "abort",
                () => finish(new DOMException("Aborted", "AbortError")),
                { once: true }
            );
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
                finish(
                    new Error(
                        data.error || data.message || "WebSocket agent error."
                    )
                );
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
            finish(
                new Error(
                    "WebSocket error. Is the agent running at " + url + "?"
                )
            );
        };

        socket.onclose = () => {
            finish();
        };
    });
}

/* ---------------------------------------------------------------
 * Demo
 * --------------------------------------------------------------- */

export async function requestDemo(config, request, onDelta, signal) {
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

/* ---------------------------------------------------------------
 * Dispatcher
 * --------------------------------------------------------------- */

export function requestReply(config, request, onDelta, signal, hooks) {
    switch (config.provider) {
        case "ollama":
            return requestOllama(config, request, onDelta, signal);
        case "browser":
            return requestBrowser(config, request, onDelta, signal, hooks);
        case "webllm":
            return requestWebLLM(config, request, onDelta, signal, hooks);
        case "ws":
            return requestWebSocket(config, request, onDelta, signal);
        case "demo":
            return requestDemo(config, request, onDelta, signal);
        case "openai":
        default:
            return requestOpenAI(config, request, onDelta, signal);
    }
}

/* ---------------------------------------------------------------
 * Detection and testing
 * --------------------------------------------------------------- */

export async function detectLocalAI() {
    try {
        const response = await fetch("/api/detect");
        const data = await response.json();
        return data?.found || null;
    } catch (error) {
        return null;
    }
}

export async function detectBrowserAI() {
    const api = getBrowserAI();
    if (!api) return null;

    try {
        const availability = await browserAvailability(api);
        if (availability === "unavailable") return null;
        return { availability };
    } catch (error) {
        return null;
    }
}

async function fetchModels(provider, endpoint) {
    const query = new URLSearchParams({ provider, endpoint });
    const response = await fetch("/api/models?" + query.toString());
    if (!response.ok) throw await serverError(response);
    const data = await response.json();
    return data.models || [];
}

export async function testOpenAI(config) {
    try {
        return await fetchModels("openai", config.endpoint);
    } catch (error) {
        if (error.status !== 404) throw error;

        /* Some compatible servers do not expose /models. Fall back to a
           one-token chat request through the proxy. */
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: "openai",
                endpoint: config.endpoint,
                model: config.model,
                apiKey: config.apiKey,
                messages: [{ role: "user", content: "ping" }],
                maxTokens: 1,
                temperature: 0,
                stream: false
            })
        });

        if (!response.ok) throw await serverError(response);
        return [];
    }
}

export async function testOllama(config) {
    const models = await fetchModels("ollama", config.endpoint);

    if (config.model && models.length) {
        const matches = models.some(
            model =>
                model === config.model ||
                model.startsWith(config.model + ":")
        );

        if (!matches) {
            throw new Error(
                "Ollama is running, but model \"" + config.model +
                "\" is not installed. Available: " + models.join(", ") +
                ". Run: ollama pull " + config.model
            );
        }
    }

    return models;
}

export async function testBrowser() {
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

export function testWebSocket(config) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(config.endpoint);
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
            finish(
                new Error(
                    "Could not open " + config.endpoint +
                    ". Is the WebSocket agent running?"
                )
            );
        };

        socket.onclose = () => {
            clearTimeout(timer);
            finish();
        };
    });
}
