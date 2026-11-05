import { useCallback, useRef, useState } from "react";
import { timestamp } from "../lib/chatConfig.js";

export function useLogs() {
    const [logs, setLogs] = useState([]);
    const idRef = useRef(0);

    const log = useCallback((message, type = "event") => {
        idRef.current += 1;
        const entry = {
            id: idRef.current,
            time: timestamp(),
            message,
            type
        };

        setLogs(previous => {
            const next = [...previous, entry];
            return next.length > 200
                ? next.slice(next.length - 200)
                : next;
        });
    }, []);

    return { logs, log };
}
