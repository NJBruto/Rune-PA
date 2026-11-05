import { useEffect, useRef } from "react";
import LogLine from "./LogLine.jsx";

export function SystemStatus({
    uiStatus,
    audioStatus,
    micStatus,
    micClass,
    soundStatus,
    outputStatus
}) {
    return (
        <section className="panel">
            <div className="panel-title">01 // SYSTEM STATUS</div>

            <div className="stat-row">
                <span className="small-muted">Interface</span>
                <span className="stat-value green" id="uiStatus">
                    {uiStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Audio API</span>
                <span className="stat-value" id="audioStatus">
                    {audioStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Microphone</span>
                <span className={micClass} id="micStatus">
                    {micStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Sound state</span>
                <span className="stat-value" id="soundStatus">
                    {soundStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Audio output</span>
                <span className="stat-value" id="outputStatus">
                    {outputStatus}
                </span>
            </div>
        </section>
    );
}

export function MemoryModule() {
    return (
        <section className="panel">
            <div className="panel-title">02 // MEMORY MODULE</div>

            <div className="memory-box">
                [ NOT INITIALIZED ]<br />
                Persistent memory: OFF<br />
                Storage engine: NONE<br />
                Records loaded: 0
            </div>

            <p className="description">
                Rune&apos;s memory module has not been implemented. No memories
                are being stored by this prototype.
            </p>
        </section>
    );
}

export function EnvironmentPanel({ browser, secure, network }) {
    return (
        <section className="panel">
            <div className="panel-title">03 // ENVIRONMENT</div>

            <div className="stat-row">
                <span className="small-muted">Browser</span>
                <span className="stat-value" id="browserStatus">
                    {browser}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Secure context</span>
                <span
                    className={"stat-value " + (secure ? "green" : "yellow")}
                    id="secureStatus"
                >
                    {secure ? "YES" : "NO"}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Connection</span>
                <span className="stat-value" id="networkStatus">
                    {network}
                </span>
            </div>
        </section>
    );
}

export function RuntimePanel({
    sessionStatus,
    uptime,
    aiStatus,
    aiClass,
    chatStatus,
    chatClass
}) {
    return (
        <section className="panel">
            <div className="panel-title">04 // RUNTIME</div>

            <div className="stat-row">
                <span className="small-muted">Session</span>
                <span className="stat-value" id="sessionStatus">
                    {sessionStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Uptime</span>
                <span className="stat-value" id="uptime">
                    {uptime}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Animation</span>
                <span className="stat-value green">CSS ACTIVE</span>
            </div>

            <div className="stat-row">
                <span className="small-muted">AI engine</span>
                <span className={aiClass} id="aiStatus">
                    {aiStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Chat mode</span>
                <span className={chatClass} id="chatStatus">
                    {chatStatus}
                </span>
            </div>
        </section>
    );
}

export function ConsolePanel({ logs }) {
    const ref = useRef(null);

    useEffect(() => {
        if (ref.current) {
            ref.current.scrollTop = ref.current.scrollHeight;
        }
    }, [logs]);

    return (
        <section className="panel">
            <div className="panel-title">05 // SYSTEM CONSOLE</div>
            <div className="console" id="console" ref={ref} aria-live="polite">
                {logs.slice(-70).map(entry => (
                    <LogLine key={entry.id} entry={entry} />
                ))}
            </div>
        </section>
    );
}

export function AudioAnalysis({
    noiseStatus,
    noiseStatusRef,
    detectionStatus,
    lastEvent
}) {
    return (
        <section className="panel">
            <div className="panel-title">06 // AUDIO ANALYSIS</div>

            <div className="stat-row">
                <span className="small-muted">Noise baseline</span>
                <span className="stat-value" id="noiseStatus" ref={noiseStatusRef}>
                    {noiseStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Detection</span>
                <span className="stat-value" id="detectionStatus">
                    {detectionStatus}
                </span>
            </div>

            <div className="stat-row">
                <span className="small-muted">Last event</span>
                <span className="stat-value" id="lastEvent">
                    {lastEvent}
                </span>
            </div>

            <p className="description">
                Adaptive noise calibration and separate activation and release
                thresholds reduce false triggers.
            </p>
        </section>
    );
}
