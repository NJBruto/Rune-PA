/* RUNE V6: Node backend.
 *
 * Responsibilities:
 *   - serve the built React app
 *   - proxy OpenAI-compatible and Ollama chat requests so the browser never
 *     hits CORS restrictions
 *   - discover local AI servers from the server side
 *
 * The browser still owns in-browser providers (Chrome AI, WebLLM, WebSocket,
 * Demo). Only OpenAI-compatible and Ollama traffic passes through here.
 */

import express from "express";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
    readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_REMOTE = process.env.RUNE_ALLOW_REMOTE === "1";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

/* ---------------------------------------------------------------
 * Endpoint helpers
 * --------------------------------------------------------------- */

const LOCAL_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]"
]);

function normalizeBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function apiRoot(endpoint) {
    let base = normalizeBase(endpoint).replace(
        /\/(chat\/completions|models)$/,
        ""
    );
    return /\/v1$/.test(base) ? base : base + "/v1";
}

function ollamaRoot(endpoint) {
    let base = normalizeBase(endpoint).replace(/\/(api\/chat|api\/tags)$/, "");
    return /\/api$/.test(base) ? base : base + "/api";
}

function assertEndpoint(endpoint, provider) {
    let url;

    try {
        url = new URL(endpoint);
    } catch (error) {
        throw new Error("Invalid endpoint URL: " + endpoint);
    }

    if (!/^https?:$/.test(url.protocol)) {
        throw new Error(
            "Only http:// and https:// endpoints are proxied by the server."
        );
    }

    if (!ALLOW_REMOTE && !LOCAL_HOSTS.has(url.hostname)) {
        throw new Error(
            "Refusing non-local endpoint " + url.hostname +
            ". Set RUNE_ALLOW_REMOTE=1 to allow it."
        );
    }

    if (provider === "ws") {
        throw new Error("WebSocket agents are handled by the browser.");
    }
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

async function readError(response) {
    let body = "";

    try {
        body = await response.text();
    } catch (error) {
        /* The body may already be consumed. */
    }

    const snippet = body
        ? " " + body.replace(/\s+/g, " ").slice(0, 400)
        : "";

    return "HTTP " + response.status + " from " + response.url + "." + snippet;
}

function modelsUrl(provider, endpoint) {
    return provider === "ollama"
        ? ollamaRoot(endpoint) + "/tags"
        : apiRoot(endpoint) + "/models";
}

/* ---------------------------------------------------------------
 * Detection
 * --------------------------------------------------------------- */

const PROBES = [
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

async function probe(entry) {
    try {
        const response = await fetch(
            modelsUrl(entry.provider, entry.endpoint),
            { signal: AbortSignal.timeout(1600) }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return { ...entry, models: extractModels(data) };
    } catch (error) {
        return null;
    }
}

app.get("/api/health", (request, response) => {
    response.json({
        ok: true,
        name: "rune-pa",
        version: pkg.version,
        node: process.version
    });
});

app.get("/api/detect", async (request, response) => {
    const results = await Promise.all(PROBES.map(probe));
    const found = results.find(Boolean);

    response.json({ found: found || null });
});

app.get("/api/models", async (request, response) => {
    const provider = String(request.query.provider || "openai");
    const endpoint = String(request.query.endpoint || "");

    try {
        assertEndpoint(endpoint, provider);

        const upstream = await fetch(modelsUrl(provider, endpoint), {
            signal: AbortSignal.timeout(4000)
        });

        if (!upstream.ok) {
            return response.status(502).json({ error: await readError(upstream) });
        }

        const data = await upstream.json();
        response.json({ models: extractModels(data) });
    } catch (error) {
        response.status(400).json({ error: error.message });
    }
});

/* ---------------------------------------------------------------
 * Chat proxy
 * --------------------------------------------------------------- */

function startStream(response) {
    response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
    });
    response.flushHeaders?.();
}

function writeDelta(response, delta) {
    if (!delta) return;

    try {
        response.write("data: " + JSON.stringify({ delta }) + "\n\n");
    } catch (error) {
        /* The client disconnected. */
    }
}

function endStream(response) {
    try {
        response.write("data: [DONE]\n\n");
        response.end();
    } catch (error) {
        /* Already closed. */
    }
}

async function proxyOpenAI(body, response, signal) {
    const url = apiRoot(body.endpoint) + "/chat/completions";
    const headers = { "Content-Type": "application/json" };

    if (body.apiKey) headers.Authorization = "Bearer " + body.apiKey;

    const upstream = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: body.model,
            messages: body.messages,
            temperature: body.temperature,
            max_tokens: body.maxTokens,
            stream: Boolean(body.stream)
        }),
        signal
    });

    if (!upstream.ok) throw new Error(await readError(upstream));

    if (!body.stream) {
        const data = await upstream.json();
        const text = textFromContent(
            data?.choices?.[0]?.message?.content ??
            data?.choices?.[0]?.text ??
            ""
        );
        return text;
    }

    if (!upstream.body) {
        throw new Error("The server returned no streaming body.");
    }

    startStream(response);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
            if (!trimmed || trimmed.startsWith(":")) continue;

            const payload = trimmed.startsWith("data:")
                ? trimmed.slice(5).trim()
                : trimmed;

            if (payload === "[DONE]") {
                endStream(response);
                return null;
            }

            try {
                const json = JSON.parse(payload);
                writeDelta(
                    response,
                    textFromContent(
                        json?.choices?.[0]?.delta?.content ??
                        json?.choices?.[0]?.message?.content ??
                        json?.choices?.[0]?.text ??
                        ""
                    )
                );
            } catch (error) {
                /* Keep-alive or non-JSON line. */
            }
        }
    }

    endStream(response);
    return null;
}

async function proxyOllama(body, response, signal) {
    const url = ollamaRoot(body.endpoint) + "/chat";

    const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: body.model,
            messages: body.messages,
            stream: Boolean(body.stream),
            options: {
                temperature: body.temperature,
                num_predict: body.maxTokens
            }
        }),
        signal
    });

    if (!upstream.ok) throw new Error(await readError(upstream));

    if (!body.stream) {
        const data = await upstream.json();
        if (data?.error) throw new Error(data.error);
        return data?.message?.content ?? data?.response ?? "";
    }

    if (!upstream.body) {
        throw new Error("Ollama returned no streaming body.");
    }

    startStream(response);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
                writeDelta(
                    response,
                    json?.message?.content ?? json?.response ?? ""
                );
            } catch (error) {
                if (error instanceof SyntaxError) continue;
                throw error;
            }
        }
    }

    endStream(response);
    return null;
}

app.post("/api/chat", async (request, response) => {
    const body = request.body || {};
    const provider = body.provider;

    if (provider !== "openai" && provider !== "ollama") {
        return response.status(400).json({
            error: "The server only proxies the openai and ollama providers."
        });
    }

    try {
        assertEndpoint(body.endpoint, provider);

        if (!Array.isArray(body.messages) || !body.messages.length) {
            throw new Error("messages must be a non-empty array.");
        }

        if (!body.model) {
            throw new Error("A model name is required.");
        }
    } catch (error) {
        return response.status(400).json({ error: error.message });
    }

    const controller = new AbortController();

    // Abort the upstream request only when the client disconnects before
    // the response finishes. Listening on the request's "close" event is
    // wrong here: it fires as soon as the request body has been consumed.
    response.on("close", () => {
        if (!response.writableEnded) controller.abort();
    });

    try {
        const text = provider === "ollama"
            ? await proxyOllama(body, response, controller.signal)
            : await proxyOpenAI(body, response, controller.signal);

        if (!body.stream) {
            response.json({ text });
        }
    } catch (error) {
        if (controller.signal.aborted) {
            if (!response.writableEnded) {
                try {
                    response.end();
                } catch (closeError) {
                    /* Already closed. */
                }
            }
            return;
        }

        const message = error?.name === "TimeoutError"
            ? "The local AI did not respond in time."
            : (error?.message || "Unknown proxy error.");

        if (response.headersSent) {
            try {
                response.write(
                    "data: " + JSON.stringify({ error: message }) + "\n\n"
                );
                response.write("data: [DONE]\n\n");
                response.end();
            } catch (writeError) {
                /* Client already disconnected. */
            }
        } else {
            response.status(502).json({ error: message });
        }
    }
});

/* ---------------------------------------------------------------
 * Static app
 * --------------------------------------------------------------- */

const distDir = path.join(__dirname, "..", "dist");

app.use(express.static(distDir));

app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
        return next();
    }

    response.sendFile(path.join(distDir, "index.html"), error => {
        if (error) {
            response
                .status(404)
                .send("Rune is not built yet. Run: npm run build");
        }
    });
});

const server = app.listen(PORT, HOST, () => {
    console.log(
        "Rune server listening on http://" + HOST + ":" + PORT +
        " (Node " + process.version + ")"
    );
});

function shutdown() {
    server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
