export default function LogLine({ entry }) {
    return (
        <div className="log-line">
            <span className="time">[{entry.time}] </span>
            <span className={entry.type}>{entry.message}</span>
        </div>
    );
}
