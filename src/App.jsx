import { useCallback, useEffect, useRef, useState } from "react";
import BackgroundConsole from "./components/BackgroundConsole.jsx";
import BootScreen from "./components/BootScreen.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import Reactor from "./components/Reactor.jsx";
import TopBar from "./components/TopBar.jsx";
import {
    AudioAnalysis,
    ConsolePanel,
    EnvironmentPanel,
    MemoryModule,
    RuntimePanel,
    SystemStatus
} from "./components/Panels.jsx";
import { useAudio } from "./hooks/useAudio.js";
import { useChat } from "./hooks/useChat.js";
import { useLogs } from "./hooks/useLogs.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, ms, label, log) {
    return Promise.race([
        Promise.resolve(promise).catch(error => {
            console.warn(label + " failed:", error);
            return null;
        }),
        new Promise(resolve => {
            setTimeout(() => {
                log(label + " timed out; continuing startup.", "warn");
                resolve(null);
            }, ms);
        })
    ]);
}

function getBrowserName() {
    const ua = navigator.userAgent;

    if (/Edg\//.test(ua)) return "EDGE";
    if (/Firefox\//.test(ua)) return "FIREFOX";
    if (/Chrome\//.test(ua)) return "CHROME";
    if (/Safari\//.test(ua)) return "SAFARI";

    return "OTHER";
}

const CHAT_STATUS = {
    connected: "CONNECTED",
    demo: "DEMO",
    connecting: "CONNECTING",
    error: "ERROR",
    offline: "READY"
};

export default function App() {
    const { logs, log } = useLogs();

    const [coreStatus, setCoreStatusState] = useState({
        main: "INITIALIZING",
        detail: "Loading interface modules"
    });

    const setCoreStatus = useCallback((main, detail = "") => {
        setCoreStatusState({ main, detail });
    }, []);

    const audio = useAudio({ log, setCoreStatus });
    const chat = useChat({ log, setCoreStatus });

    const [boot, setBoot] = useState({
        done: false,
        label: "AGENT INITIALISING...",
        detail: "Preparing local browser agent",
        error: ""
    });
    const [greeting, setGreeting] = useState("HEY SIR, I AM RUNE.");
    const [collapsed, setCollapsed] = useState(false);

    const [browser] = useState(getBrowserName);
    const [secure] = useState(() => Boolean(window.isSecureContext));
    const [network, setNetwork] = useState(
        navigator.onLine ? "ONLINE" : "OFFLINE"
    );
    const [clock, setClock] = useState(
        new Date().toLocaleTimeString()
    );
    const [uptime, setUptime] = useState("0s");

    const startRef = useRef(performance.now());
    const bootTimerRef = useRef(null);
    const bootedRef = useRef(false);
    const chatPanelRef = useRef(null);
    const chatInputRef = useRef(null);

    useEffect(() => {
        const timer = setInterval(() => {
            setClock(new Date().toLocaleTimeString());
            setUptime(
                Math.floor((performance.now() - startRef.current) / 1000) +
                    "s"
            );
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        function online() {
            setNetwork("ONLINE");
            log("Browser reports network connection available.", "ok");
        }

        function offline() {
            setNetwork("OFFLINE");
            log("Browser reports network connection unavailable.", "warn");
        }

        window.addEventListener("online", online);
        window.addEventListener("offline", offline);

        return () => {
            window.removeEventListener("online", online);
            window.removeEventListener("offline", offline);
        };
    }, [log]);

    const bootRune = useCallback(async () => {
        if (bootTimerRef.current) clearTimeout(bootTimerRef.current);

        setBoot({
            done: false,
            label: "AGENT INITIALISING...",
            detail: "Preparing local browser agent",
            error: ""
        });
        setCoreStatus("INITIALIZING", "Loading local agent module");
        log("Rune startup sequence started.", "event");

        bootTimerRef.current = setTimeout(() => {
            setBoot(previous => {
                if (previous.done) return previous;
                log(
                    "Boot watchdog: startup exceeded 20s; revealing interface.",
                    "warn"
                );
                return {
                    ...previous,
                    done: true,
                    label: "STARTUP TIMED OUT"
                };
            });
        }, 20000);

        try {
            log("Boot 1/5: checking browser environment.", "event");
            setBoot(previous => ({
                ...previous,
                detail: "Checking browser environment"
            }));
            await sleep(250);

            log("Boot 2/5: importing ./lib/agent.js ...", "event");
            setBoot(previous => ({
                ...previous,
                detail: "Loading local agent module"
            }));
            const module = await import("./lib/agent.js");

            log("Local agent module downloaded by browser.", "ok");
            log("Boot 3/5: running agent.initializeAgent().", "event");
            setBoot(previous => ({
                ...previous,
                detail: "Initializing agent"
            }));
            await sleep(250);

            const agent = await module.initializeAgent();

            if (!agent || agent.initialized !== true) {
                throw new Error("Agent initialization did not complete.");
            }

            window.RUNE_AGENT = agent;

            log("Boot 4/5: chat module ready.", "event");
            log("Local chat module loaded.", "ok");
            log("Boot 5/5: finalizing interface.", "event");
            setBoot(previous => ({
                ...previous,
                detail: "Local module initialized"
            }));
            await sleep(400);

            setBoot(previous => ({
                ...previous,
                label: "LOCAL MODULE INITIALIZED"
            }));

            // The boot overlay must never depend on audio permission.
            await withTimeout(
                audio.tryWakeSound(true),
                1500,
                "Wake sound",
                log
            );

            if (bootTimerRef.current) clearTimeout(bootTimerRef.current);

            setBoot(previous => ({ ...previous, done: true }));
            setGreeting("Hey there, How can I help you today?");

            log("Local module initialization completed.", "ok");
            log("Agent version: " + agent.version, "ok");
            log(
                "Audio API: " +
                    (agent.checks.audio ? "available" : "unavailable"),
                agent.checks.audio ? "ok" : "warn"
            );
            log(
                "Microphone API: " +
                    (agent.checks.microphone ? "available" : "unavailable"),
                agent.checks.microphone ? "ok" : "warn"
            );
            log(
                "Speech recognition: " +
                    (agent.checks.speechRecognition
                        ? "available"
                        : "unavailable"),
                agent.checks.speechRecognition ? "ok" : "warn"
            );
            log(
                "Browser AI (Prompt API): " +
                    (agent.checks.browserAI ? "available" : "unavailable"),
                agent.checks.browserAI ? "ok" : "warn"
            );
            log("Rune interface is ready for interaction.", "ok");
        } catch (error) {
            console.error(error);

            if (bootTimerRef.current) clearTimeout(bootTimerRef.current);

            setBoot({
                done: false,
                label: "INITIALIZATION FAILED",
                detail: "Initialization stopped",
                error:
                    error.message +
                    " Check the background console and reload."
            });
            log("Agent initialization failed: " + error.message, "error");
        }
    }, [audio.tryWakeSound, log, setCoreStatus]);

    useEffect(() => {
        if (bootedRef.current) return;
        bootedRef.current = true;
        bootRune();

        return () => {
            if (bootTimerRef.current) clearTimeout(bootTimerRef.current);
        };
    }, [bootRune]);

    const openChat = useCallback(() => {
        chatPanelRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        setTimeout(() => {
            chatInputRef.current?.focus({ preventScroll: true });
        }, 350);
    }, []);

    const badge = boot.error
        ? "AGENT OFFLINE"
        : !boot.done
            ? "INITIALISING"
            : chat.generating
                ? "AI THINKING"
                : chat.engine.badge;

    const chatStatusText =
        CHAT_STATUS[chat.engine.state] || "READY";

    return (
        <>
            <BootScreen boot={boot} onRetry={bootRune} />

            <BackgroundConsole
                logs={logs}
                collapsed={collapsed}
                onToggle={() => setCollapsed(value => !value)}
            />

            <div id="app">
                <TopBar
                    badge={badge}
                    clock={clock}
                    live={!boot.error}
                />

                <main className="dashboard">
                    <aside className="column left-column">
                        <SystemStatus
                            uiStatus={
                                boot.error
                                    ? "AGENT FAILED"
                                    : boot.done
                                        ? "UI READY"
                                        : "STARTING"
                            }
                            audioStatus={audio.audioStatus}
                            micStatus={audio.micStatus}
                            micClass={audio.micClass}
                            soundStatus={audio.soundStatus}
                            outputStatus={audio.outputStatus}
                        />
                        <MemoryModule />
                        <EnvironmentPanel
                            browser={browser}
                            secure={secure}
                            network={network}
                        />
                    </aside>

                    <Reactor
                        greeting={greeting}
                        booted={boot.done}
                        coreMain={coreStatus.main}
                        coreSub={coreStatus.detail}
                        listening={audio.listening}
                        micStatus={audio.micStatus}
                        micClass={audio.micClass}
                        onMic={audio.startMicrophone}
                        onWake={audio.playWakeSound}
                        onChat={openChat}
                        coreWrapRef={audio.coreWrapRef}
                        coreRef={audio.coreRef}
                        levelTextRef={audio.levelTextRef}
                        meterFillRef={audio.meterFillRef}
                    />

                    <aside className="column right-column">
                        <RuntimePanel
                            sessionStatus={
                                boot.done
                                    ? "CHAT MODULE LOADED"
                                    : "INITIALISING"
                            }
                            uptime={uptime}
                            aiStatus={chat.engine.text}
                            aiClass={"stat-value " + chat.engine.cls}
                            chatStatus={chatStatusText}
                            chatClass={"stat-value " + chat.engine.cls}
                        />
                        <ConsolePanel logs={logs} />
                        <AudioAnalysis
                            noiseStatus={audio.noiseStatus}
                            noiseStatusRef={audio.noiseStatusRef}
                            detectionStatus={audio.detectionStatus}
                            lastEvent={audio.lastEvent}
                        />
                    </aside>

                    <ChatPanel
                        chat={chat}
                        panelRef={chatPanelRef}
                        inputRef={chatInputRef}
                    />
                </main>

                <footer className="footer">
                    <span>RUNE // LOCAL PROTOTYPE</span>
                    <span>MEMORY: UNINITIALIZED</span>
                    <span id="footerMode">{audio.footerMode}</span>
                </footer>
            </div>
        </>
    );
}
