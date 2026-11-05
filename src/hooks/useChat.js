import { useCallback, useEffect, useRef, useState } from "react";
import {
    PROVIDER_PRESETS,
    buildRequestMessages,
    clamp,
    friendlyError,
    hasSavedConfig,
    isKnownEndpoint,
    isKnownModel,
    loadConfig,
    persistConfig,
    providerHint,
    validateConfig
} from "../lib/chatConfig.js";
import {
    detectBrowserAI,
    detectLocalAI,
    requestReply,
    testBrowser,
    testOllama,
    testOpenAI,
    testWebSocket
} from "../lib/providers.js";

const ENGINE_STATES = {
    connected: { text: "CONNECTED", cls: "green", badge: "AI CONNECTED" },
    connecting: { text: "CONNECTING", cls: "yellow", badge: "AI CONNECTING" },
    offline: { text: "NOT CONNECTED", cls: "yellow", badge: "AI NOT CONNECTED" },
    demo: { text: "DEMO MODE", cls: "yellow", badge: "DEMO MODE" },
    error: { text: "CONNECTION ERROR", cls: "red", badge: "AI ERROR" }
};

let nextId = 1;

function initialEngine(provider) {
    return provider === "demo" ? "demo" : "offline";
}

function speakReply(text, config) {
    if (!config.speak) return;
    if (!("speechSynthesis" in window)) return;

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

export function useChat({ log, setCoreStatus }) {
    const savedRef = useRef(hasSavedConfig());
    const initialConfigRef = useRef(loadConfig());

    const [config, setConfig] = useState(initialConfigRef.current);
    const [messages, setMessages] = useState(() => [{
        id: nextId++,
        role: "system",
        content:
            "Chat cleared. Configure a local AI above, or use Demo mode to test the interface."
    }]);
    const [draft, setDraft] = useState("");
    const [generating, setGenerating] = useState(false);
    const [note, setNoteState] = useState({ text: "", type: "" });
    const [hint, setHint] = useState(
        providerHint(initialConfigRef.current.provider)
    );
    const [models, setModels] = useState([]);
    const [dictating, setDictating] = useState(false);
    const [engine, setEngine] = useState(() => {
        const state = initialEngine(initialConfigRef.current.provider);
        return { state, ...ENGINE_STATES[state] };
    });

    const configRef = useRef(config);
    const messagesRef = useRef(messages);
    const generatingRef = useRef(false);
    const controllerRef = useRef(null);
    const recognitionRef = useRef(null);
    const userTouchedRef = useRef(false);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    const commitMessages = useCallback(next => {
        messagesRef.current = next;
        setMessages(next);
    }, []);

    const setNote = useCallback((text, type = "") => {
        setNoteState({ text: text || "", type });
    }, []);

    const setEngineState = useCallback((state, detail = "") => {
        const info = ENGINE_STATES[state] || ENGINE_STATES.offline;

        setEngine({ state, ...info });

        if (detail) setHint(detail);

        if (state === "connected") {
            setCoreStatus(
                "CHAT READY",
                "Connected to " +
                    (configRef.current.model || configRef.current.provider)
            );
        } else if (state === "connecting") {
            setCoreStatus("THINKING", "Waiting for the local AI");
        } else if (state === "offline") {
            setCoreStatus("INTERFACE READY", "AI engine not connected");
        } else if (state === "demo") {
            setCoreStatus("DEMO MODE", "No local AI connected");
        } else if (state === "error") {
            setCoreStatus("AI ERROR", detail || "Check the local AI server");
        }
    }, [setCoreStatus]);

    const applyConfig = useCallback(next => {
        configRef.current = next;
        setConfig(next);
    }, []);

    const changeProvider = useCallback(provider => {
        userTouchedRef.current = true;

        const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.demo;
        const previous = configRef.current;
        const fixedEndpoint =
            provider === "demo" ||
            provider === "browser" ||
            provider === "webllm";
        const fixedModel = provider === "demo" || provider === "browser";

        const next = {
            ...previous,
            provider,
            endpoint: fixedEndpoint
                ? preset.endpoint
                : !previous.endpoint || isKnownEndpoint(previous.endpoint)
                    ? preset.endpoint
                    : previous.endpoint,
            model: fixedModel
                ? preset.model
                : !previous.model || isKnownModel(previous.model)
                    ? preset.model
                    : previous.model,
            apiKey:
                provider === "demo" || provider === "webllm"
                    ? ""
                    : previous.apiKey
        };

        applyConfig(next);
        setModels([]);
        setHint(providerHint(provider));

        if (provider === "demo") {
            setEngineState("demo", "Demo mode is ready. No server needed.");
            setNote("Demo mode active. No server needed.", "yellow");
        } else {
            setEngineState(
                "offline",
                "Press TEST to connect, or DETECT to scan local ports."
            );
            setNote("Provider changed. Press TEST to verify.", "");
        }
    }, [applyConfig, setEngineState, setNote]);

    const updateField = useCallback((field, value) => {
        userTouchedRef.current = true;

        setConfig(previous => {
            let nextValue = value;

            if (field === "temperature") {
                nextValue = clamp(Number(value), 0, 2, 0.7);
            } else if (field === "maxTokens") {
                nextValue = Math.round(
                    clamp(Number(value), 32, 8192, 512)
                );
            }

            const next = { ...previous, [field]: nextValue };
            configRef.current = next;
            return next;
        });
    }, []);

    const saveConfig = useCallback(() => {
        try {
            const next = configRef.current;
            validateConfig(next);
            persistConfig(next);
            setNote("Settings saved.", "green");
            log("Chat settings saved.", "ok");

            if (next.provider === "demo") {
                setEngineState("demo", "Demo mode is ready.");
            } else {
                setEngineState(
                    "offline",
                    "Settings saved. Press TEST to connect."
                );
            }
        } catch (error) {
            setNote(error.message, "red");
            log(error.message, "warn");
        }
    }, [log, setEngineState, setNote]);

    const testConnection = useCallback(async (options = {}) => {
        const silent = Boolean(options.silent);
        const cfg = configRef.current;

        try {
            validateConfig(cfg);
        } catch (error) {
            setEngineState("error", error.message);
            setNote(error.message, "red");
            if (!silent) log(error.message, "error");
            return false;
        }

        if (!silent) {
            setEngineState(
                "connecting",
                "Testing " + (cfg.endpoint || cfg.provider) + "..."
            );
            setNote("Testing connection...", "yellow");
            log(
                "Testing AI connection: " +
                    cfg.provider + " " + (cfg.endpoint || ""),
                "event"
            );
        }

        try {
            let nextModels = [];
            let detail = "";

            if (cfg.provider === "demo") {
                detail = "Demo mode is ready. No server required.";
            } else if (cfg.provider === "openai") {
                nextModels = await testOpenAI(cfg);
                detail = "Connected to " + cfg.endpoint +
                    (nextModels.length
                        ? " — " + nextModels.length + " model(s) available."
                        : ".");
            } else if (cfg.provider === "ollama") {
                nextModels = await testOllama(cfg);
                detail = "Connected to Ollama at " + cfg.endpoint +
                    (nextModels.length
                        ? " — models: " + nextModels.join(", ")
                        : ".");
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

                detail =
                    "WebGPU is available. The WebLLM model loads on the first message.";
            } else if (cfg.provider === "ws") {
                await testWebSocket(cfg);
                detail = "WebSocket agent reachable at " + cfg.endpoint + ".";
            }

            setModels(nextModels);
            persistConfig(cfg);
            setEngineState(
                cfg.provider === "demo" ? "demo" : "connected",
                detail
            );
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
    }, [log, setEngineState, setNote]);

    const detect = useCallback(async (options = {}) => {
        const silent = Boolean(options.silent);

        if (!silent) {
            setNote("Scanning common local AI ports...", "yellow");
            setEngineState(
                "connecting",
                "Scanning local ports for an AI server..."
            );
            log("Scanning common local AI endpoints.", "event");
        }

        const found = await detectLocalAI();

        if (found) {
            const detectedModel =
                found.models[0] ||
                PROVIDER_PRESETS[found.provider].model;

            const next = {
                ...configRef.current,
                provider: found.provider,
                endpoint: found.endpoint,
                model: detectedModel,
                apiKey: ""
            };

            applyConfig(next);
            persistConfig(next);
            setModels(found.models);
            setHint(providerHint(found.provider));

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
                        (found.models.length
                            ? " (" + found.models.length + " model" +
                              (found.models.length === 1 ? "" : "s") + ")"
                            : "")
                );
                setNote(
                    "Detected " + (detectedModel || "server") + ".",
                    "green"
                );
            }

            if (!silent) {
                log(
                    "Detected local AI: " + found.provider +
                        " at " + found.endpoint +
                        (found.models.length
                            ? " — models: " + found.models.join(", ")
                            : ""),
                    "ok"
                );
            }

            return true;
        }

        const browser = await detectBrowserAI();

        if (browser) {
            const next = {
                ...configRef.current,
                provider: "browser",
                endpoint: "",
                model: "gemini-nano",
                apiKey: ""
            };

            applyConfig(next);
            persistConfig(next);
            setHint(providerHint("browser"));
            setEngineState(
                "connected",
                "Using Chrome's built-in AI (" +
                    browser.availability + ")."
            );
            setNote("Chrome built-in AI is available.", "green");

            if (!silent) {
                log(
                    "Detected Chrome built-in AI: " +
                        browser.availability,
                    "ok"
                );
            }

            return true;
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
    }, [applyConfig, log, setEngineState, setNote]);

    const stopGeneration = useCallback(() => {
        if (controllerRef.current) controllerRef.current.abort();

        commitMessages(
            messagesRef.current.map(message =>
                message.streaming
                    ? { ...message, streaming: false }
                    : message
            )
        );

        log("Generation stopped.", "warn");
    }, [commitMessages, log]);

    const clearChat = useCallback(() => {
        if (generatingRef.current) stopGeneration();

        commitMessages([
            {
                id: nextId++,
                role: "system",
                content:
                    "Chat cleared. Configure a local AI above, or use Demo mode to test the interface."
            }
        ]);

        log("Chat history cleared.", "warn");
    }, [commitMessages, log, stopGeneration]);

    const sendMessage = useCallback(async text => {
        if (generatingRef.current) return;

        const content = String(text || "").trim();
        if (!content) return;

        const cfg = configRef.current;
        const userMessage = { id: nextId++, role: "user", content };
        const request = buildRequestMessages(cfg, [
            ...messagesRef.current,
            userMessage
        ]);
        const assistant = {
            id: nextId++,
            role: "assistant",
            content: "",
            streaming: true
        };

        commitMessages([
            ...messagesRef.current,
            userMessage,
            assistant
        ]);

        setDraft("");
        setGenerating(true);
        generatingRef.current = true;

        const controller = new AbortController();
        controllerRef.current = controller;

        let full = "";

        try {
            await requestReply(
                cfg,
                request,
                delta => {
                    full += delta;
                    commitMessages(
                        messagesRef.current.map(message =>
                            message.id === assistant.id
                                ? { ...message, content: full }
                                : message
                        )
                    );
                },
                controller.signal,
                { log, setNote, setHint }
            );

            commitMessages(
                messagesRef.current.map(message =>
                    message.id === assistant.id
                        ? { ...message, content: full, streaming: false }
                        : message
                )
            );

            if (full) speakReply(full, cfg);

            if (cfg.provider === "demo") {
                setEngineState(
                    "demo",
                    "Demo mode streams a local echo response. No AI server is needed."
                );
            } else {
                setEngineState(
                    "connected",
                    "Connected to " +
                        (cfg.model || cfg.provider) + "."
                );
            }

            log("Reply received from " + cfg.provider + ".", "ok");
        } catch (error) {
            if (error.name === "AbortError") {
                commitMessages(
                    messagesRef.current.map(message =>
                        message.id === assistant.id
                            ? {
                                ...message,
                                content: full,
                                streaming: false
                            }
                            : message
                    )
                );

                if (!full) {
                    commitMessages(
                        messagesRef.current.filter(
                            message => message.id !== assistant.id
                        )
                    );
                }
            } else {
                const message = friendlyError(error, cfg);

                commitMessages(
                    messagesRef.current
                        .filter(item => item.id !== assistant.id || full)
                        .map(item =>
                            item.id === assistant.id
                                ? {
                                    ...item,
                                    content: full,
                                    streaming: false
                                }
                                : item
                        )
                        .concat([{
                            id: nextId++,
                            role: "system",
                            content: "AI error: " + message
                        }])
                );

                setEngineState("error", message);
                log("AI request failed: " + message, "error");
            }
        } finally {
            controllerRef.current = null;
            generatingRef.current = false;
            setGenerating(false);
        }
    }, [commitMessages, log, setEngineState, setNote]);

    const toggleDictation = useCallback(() => {
        const Recognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!Recognition) {
            log(
                "Speech recognition is not available in this browser. Chrome or Edge is recommended.",
                "warn"
            );
            setNote("Speech recognition is not supported here.", "yellow");
            return;
        }

        if (recognitionRef.current) {
            recognitionRef.current.stop();
            return;
        }

        const recognition = new Recognition();
        recognitionRef.current = recognition;
        recognition.lang = navigator.language || "en-US";
        recognition.interimResults = true;
        recognition.continuous = false;

        const base = draft.trim();
        let finalText = base ? base + " " : "";

        setDictating(true);

        recognition.onresult = event => {
            let interim = "";

            for (
                let index = event.resultIndex;
                index < event.results.length;
                index += 1
            ) {
                const transcript = event.results[index][0].transcript;

                if (event.results[index].isFinal) {
                    finalText += transcript;
                } else {
                    interim += transcript;
                }
            }

            setDraft((finalText + interim).trim());
        };

        recognition.onerror = event => {
            log("Dictation error: " + event.error, "warn");
        };

        recognition.onend = () => {
            recognitionRef.current = null;
            setDictating(false);
        };

        try {
            recognition.start();
            log("Dictation started.", "event");
        } catch (error) {
            recognitionRef.current = null;
            setDictating(false);
            log("Dictation could not start: " + error.message, "error");
        }
    }, [draft, log, setNote]);

    useEffect(() => {
        const cfg = initialConfigRef.current;

        if (cfg.provider === "demo") {
            setEngineState(
                "demo",
                "Demo mode is ready. Configure a local AI above."
            );
            setNote("Demo mode active. No server needed.", "yellow");
        } else {
            setEngineState(
                "offline",
                "Saved settings loaded. Press TEST to connect."
            );
            setNote("Saved settings loaded.", "");
        }

        log(
            "Chat module initialized. Providers: OpenAI-compatible, Ollama, Chrome AI, WebLLM, WebSocket, Demo.",
            "ok"
        );

        const timer = setTimeout(() => {
            if (userTouchedRef.current || generatingRef.current) return;

            if (!savedRef.current) {
                detect({ silent: true });
            } else if (configRef.current.provider !== "demo") {
                testConnection({ silent: true });
            }
        }, savedRef.current ? 900 : 700);

        return () => clearTimeout(timer);
    }, [detect, log, setEngineState, setNote, testConnection]);

    useEffect(() => {
        return () => {
            if (controllerRef.current) controllerRef.current.abort();
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.stop();
                } catch (error) {
                    /* Already stopped. */
                }
            }
        };
    }, []);

    return {
        config,
        messages,
        draft,
        setDraft,
        generating,
        note,
        hint,
        models,
        dictating,
        engine,
        changeProvider,
        updateField,
        saveConfig,
        testConnection,
        detect,
        sendMessage,
        stopGeneration,
        clearChat,
        toggleDictation,
        setNote
    };
}
