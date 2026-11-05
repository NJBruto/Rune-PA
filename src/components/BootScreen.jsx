export default function BootScreen({ boot, onRetry }) {
    const { done, label, detail, error } = boot;

    return (
        <div
            id="bootScreen"
            role="status"
            aria-live="polite"
            className={done ? "bootDone" : ""}
        >
            <div className="bootContent">
                <div className="bootLogo">RUNE</div>
                <div className="bootLabel" id="bootLabel">
                    {label}
                </div>
                <div
                    className="bootLoader"
                    role="img"
                    aria-label="Rune is initializing"
                />
                <div className="bootDetail" id="bootDetail">
                    {detail}
                </div>
                <div
                    id="bootError"
                    style={{ display: error ? "block" : "none" }}
                >
                    {error}
                </div>
                <button
                    id="retryBoot"
                    type="button"
                    onClick={onRetry}
                    style={{ display: error ? "inline-block" : "none" }}
                >
                    RETRY INITIALIZATION
                </button>
            </div>
        </div>
    );
}
