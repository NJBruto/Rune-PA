import { useEffect, useRef } from "react";
import LogLine from "./LogLine.jsx";

export default function BackgroundConsole({ logs, collapsed, onToggle }) {
    const bodyRef = useRef(null);

    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <aside
            id="bgConsole"
            className={collapsed ? "collapsed" : ""}
            aria-live="polite"
            aria-label="Background load console"
        >
            <div className="bg-console-head">
                <span className="bg-left">
                    <span className="bg-dot" />
                    BACKGROUND LOG
                </span>
                <button
                    id="bgConsoleToggle"
                    type="button"
                    title="Collapse or expand"
                    onClick={onToggle}
                >
                    {collapsed ? "SHOW" : "HIDE"}
                </button>
            </div>
            <div className="bg-console-body" id="bgConsoleBody" ref={bodyRef}>
                {logs.map(entry => (
                    <LogLine key={entry.id} entry={entry} />
                ))}
            </div>
        </aside>
    );
}
