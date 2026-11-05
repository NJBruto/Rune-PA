export default function TopBar({ badge, clock, live }) {
    return (
        <header className="topbar">
            <div>
                <div className="brand">RUNE</div>
                <div className="brand-sub">PERSONAL ASSISTANT // V6</div>
            </div>

            <div className="header-right">
                <div>
                    <span className={live ? "live-dot" : "live-dot idle"} />
                    <span id="systemBadge">{badge}</span>
                </div>
                <div className="small-muted" id="clock">
                    {clock}
                </div>
                <div className="small-muted">REACT + NODE</div>
            </div>
        </header>
    );
}
