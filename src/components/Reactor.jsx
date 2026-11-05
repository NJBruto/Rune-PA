export default function Reactor({
    greeting,
    booted,
    coreMain,
    coreSub,
    listening,
    micStatus,
    onMic,
    onWake,
    onChat,
    coreWrapRef,
    coreRef,
    levelTextRef,
    meterFillRef
}) {
    const micLabel = listening
        ? "DISABLE MICROPHONE"
        : micStatus === "UNAVAILABLE"
            ? "RETRY MICROPHONE"
            : micStatus === "CONNECTING..."
                ? "CONNECTING..."
                : "ENABLE MICROPHONE";

    return (
        <section className="center">
            <div className="greeting" id="greetingText">
                {greeting}
                {!booted && (
                    <>
                        <br />
                        <span className="small-muted">
                            SYSTEM AWAITS YOUR INPUT
                        </span>
                    </>
                )}
            </div>

            <div className="reactor">
                <div className="ring r4" />
                <div className="ring r1" />
                <div className="ring r2" />
                <div className="ring r3" />
                <div className="ring r5" />

                <div className="orbit" />
                <div className="orbit orbit2" />

                <div className="particle" />
                <div className="particle p2" />
                <div className="particle p3" />

                <div className="core-wrap" id="coreWrap" ref={coreWrapRef}>
                    <div className="halo" />
                    <div className="core" id="core" ref={coreRef} />
                </div>
            </div>

            <div className="core-status" id="coreStatus">
                {coreMain}
                <span id="coreSubstatus">{coreSub}</span>
            </div>

            <div className="controls">
                <button
                    className="btn secondary"
                    id="startMic"
                    onClick={onMic}
                    disabled={micStatus === "CONNECTING..."}
                >
                    {micLabel}
                </button>
                <button className="btn" id="wakeButton" onClick={onWake}>
                    PLAY WAKE SOUND
                </button>
                <button className="btn" id="openChat" onClick={onChat}>
                    CHAT MODE
                </button>
            </div>

            <div
                style={{
                    width: "min(100%, 340px)",
                    marginTop: "20px"
                }}
            >
                <div className="stat-row">
                    <span className="small-muted">INPUT LEVEL</span>
                    <span id="levelText" ref={levelTextRef}>
                        0%
                    </span>
                </div>
                <div className="meter">
                    <div
                        className="meter-fill"
                        id="meterFill"
                        ref={meterFillRef}
                    />
                </div>
                <p className="description">
                    Sound level is estimated locally from microphone input.
                    Speech recognition is available in the chat composer.
                </p>
            </div>
        </section>
    );
}
