import { useEffect, useRef } from "react";
import { PROVIDER_PRESETS } from "../lib/chatConfig.js";
import { renderMarkdown } from "../lib/markdown.js";

function Message({ message }) {
    const label =
        message.role === "user"
            ? "YOU"
            : message.role === "assistant"
                ? "RUNE"
                : "SYSTEM";

    const className =
        "msg-body" + (message.streaming ? " streaming" : "");

    return (
        <div className={"msg " + message.role}>
            <div className="msg-label">{label}</div>

            {message.role === "assistant" && !message.streaming ? (
                <div
                    className={className}
                    dangerouslySetInnerHTML={{
                        __html: renderMarkdown(message.content)
                    }}
                />
            ) : (
                <div className={className}>{message.content}</div>
            )}
        </div>
    );
}

export default function ChatPanel({ chat, panelRef, inputRef }) {
    const logRef = useRef(null);
    const stickRef = useRef(true);

    const provider = chat.config.provider;
    const fixedEndpoint =
        provider === "demo" || provider === "browser" || provider === "webllm";
    const fixedModel = provider === "demo" || provider === "browser";

    useEffect(() => {
        if (stickRef.current && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [chat.messages]);

    useEffect(() => {
        const input = inputRef.current;

        if (!input) return;

        input.style.height = "auto";
        input.style.height =
            Math.min(input.scrollHeight, 160) + "px";
    }, [chat.draft, inputRef]);

    function handleScroll() {
        const element = logRef.current;

        if (!element) return;

        stickRef.current =
            element.scrollHeight -
                element.scrollTop -
                element.clientHeight <
            80;
    }

    function submit(event) {
        event.preventDefault();
        chat.sendMessage(chat.draft);
    }

    function handleKeyDown(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chat.sendMessage(chat.draft);
        }
    }

    return (
        <section className="panel chat-panel" id="chatPanel" ref={panelRef}>
            <div className="panel-title chat-title">
                <span>07 // CHAT MODE</span>
                <span
                    className={"chat-engine " + chat.engine.cls}
                    id="chatEngineStatus"
                >
                    AI ENGINE: {chat.engine.text}
                </span>
            </div>

            <details className="chat-settings" id="chatSettings">
                <summary>CONFIG / LOCAL AI</summary>

                <div className="settings-grid">
                    <label className="field">
                        <span>Provider</span>
                        <select
                            id="chatProvider"
                            value={provider}
                            onChange={event =>
                                chat.changeProvider(event.target.value)
                            }
                        >
                            <option value="openai">
                                OpenAI-compatible (LM Studio, llama.cpp, Jan, vLLM)
                            </option>
                            <option value="ollama">Ollama</option>
                            <option value="browser">
                                Chrome built-in AI (Gemini Nano)
                            </option>
                            <option value="webllm">
                                WebLLM (in-browser, WebGPU)
                            </option>
                            <option value="demo">Demo (offline test)</option>
                            <option value="ws">WebSocket agent (custom)</option>
                        </select>
                    </label>

                    <label className="field">
                        <span>Endpoint / base URL</span>
                        <input
                            id="chatEndpoint"
                            type="text"
                            spellCheck="false"
                            autoComplete="off"
                            placeholder="http://localhost:1234/v1"
                            value={chat.config.endpoint}
                            disabled={fixedEndpoint}
                            onChange={event =>
                                chat.updateField("endpoint", event.target.value)
                            }
                        />
                    </label>

                    <label className="field">
                        <span>Model</span>
                        <input
                            id="chatModel"
                            type="text"
                            spellCheck="false"
                            autoComplete="off"
                            list="chatModelList"
                            placeholder={
                                PROVIDER_PRESETS[provider]?.model ||
                                "model name"
                            }
                            value={chat.config.model}
                            disabled={fixedModel}
                            onChange={event =>
                                chat.updateField("model", event.target.value)
                            }
                        />
                        <datalist id="chatModelList">
                            {chat.models.map(model => (
                                <option key={model} value={model} />
                            ))}
                        </datalist>
                    </label>

                    <label className="field">
                        <span>API key (optional)</span>
                        <input
                            id="chatApiKey"
                            type="password"
                            autoComplete="off"
                            placeholder="not needed for most local servers"
                            value={chat.config.apiKey}
                            disabled={
                                provider === "demo" || provider === "webllm"
                            }
                            onChange={event =>
                                chat.updateField("apiKey", event.target.value)
                            }
                        />
                    </label>

                    <label className="field wide">
                        <span>System prompt</span>
                        <textarea
                            id="chatSystemPrompt"
                            rows={2}
                            value={chat.config.systemPrompt}
                            onChange={event =>
                                chat.updateField(
                                    "systemPrompt",
                                    event.target.value
                                )
                            }
                        />
                    </label>

                    <label className="field">
                        <span>Temperature</span>
                        <input
                            id="chatTemperature"
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={chat.config.temperature}
                            onChange={event =>
                                chat.updateField(
                                    "temperature",
                                    event.target.value
                                )
                            }
                        />
                    </label>

                    <label className="field">
                        <span>Max tokens</span>
                        <input
                            id="chatMaxTokens"
                            type="number"
                            min="32"
                            max="8192"
                            step="32"
                            value={chat.config.maxTokens}
                            onChange={event =>
                                chat.updateField(
                                    "maxTokens",
                                    event.target.value
                                )
                            }
                        />
                    </label>

                    <label className="check">
                        <input
                            id="chatStream"
                            type="checkbox"
                            checked={chat.config.stream}
                            onChange={event =>
                                chat.updateField("stream", event.target.checked)
                            }
                        />
                        Stream tokens
                    </label>

                    <label className="check">
                        <input
                            id="chatSpeak"
                            type="checkbox"
                            checked={chat.config.speak}
                            onChange={event =>
                                chat.updateField("speak", event.target.checked)
                            }
                        />
                        Speak replies
                    </label>

                    <label className="check">
                        <input
                            id="chatThink"
                            type="checkbox"
                            checked={Boolean(chat.config.think)}
                            onChange={event =>
                                chat.updateField("think", event.target.checked)
                            }
                        />
                        Qwen thinking mode
                    </label>
                </div>

                <div className="settings-actions">
                    <button
                        className="btn secondary"
                        id="chatDetect"
                        type="button"
                        onClick={() => chat.detect()}
                    >
                        DETECT LOCAL AI
                    </button>
                    <button
                        className="btn"
                        id="chatTest"
                        type="button"
                        onClick={() => chat.testConnection()}
                    >
                        TEST
                    </button>
                    <button
                        className="btn"
                        id="chatSave"
                        type="button"
                        onClick={chat.saveConfig}
                    >
                        SAVE
                    </button>
                    <span
                        className={"settings-note " + chat.note.type}
                        id="chatSettingsNote"
                    >
                        {chat.note.text}
                    </span>
                </div>
            </details>

            <div
                className="chat-log"
                id="chatLog"
                ref={logRef}
                onScroll={handleScroll}
                aria-live="polite"
            >
                {chat.messages.map(message => (
                    <Message key={message.id} message={message} />
                ))}
            </div>

            <form className="chat-form" id="chatForm" onSubmit={submit}>
                <textarea
                    id="chatInput"
                    ref={inputRef}
                    rows={2}
                    value={chat.draft}
                    onChange={event => chat.setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Rune anything... (Enter to send, Shift+Enter for a new line)"
                />

                <div className="chat-actions">
                    <button
                        className="btn secondary"
                        id="chatSend"
                        type="submit"
                        disabled={chat.generating}
                    >
                        SEND
                    </button>
                    <button
                        className="btn"
                        id="chatStop"
                        type="button"
                        hidden={!chat.generating}
                        onClick={chat.stopGeneration}
                    >
                        STOP
                    </button>
                    <button
                        className={"btn" + (chat.dictating ? " active" : "")}
                        id="chatDictate"
                        type="button"
                        onClick={chat.toggleDictation}
                    >
                        {chat.dictating ? "LISTENING..." : "DICTATE"}
                    </button>
                    <button
                        className="btn"
                        id="chatClear"
                        type="button"
                        onClick={chat.clearChat}
                    >
                        CLEAR
                    </button>
                </div>
            </form>

            <div className="chat-hint" id="chatHint">
                {chat.hint}
            </div>
        </section>
    );
}
