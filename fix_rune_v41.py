from pathlib import Path

p = Path("index.html")
s = p.read_text()

def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"Stopped safely at {label}: found {count} matches.")
    s = s.replace(old, new, 1)

# Replace the loading bar CSS with a circular spinner.
replace_once(
''' .bootTrack {
    width: 100%;''',
''' .bootTrack {
    width: 100%;''',
"CSS marker"
) if False else None

start = s.find(".bootTrack {")
end = s.find(".bootPercent {", start)
if start == -1 or end == -1:
    raise SystemExit("Could not find the loading-bar CSS; no changes saved.")

end = s.find("\n}", end) + 2
if end < 2:
    raise SystemExit("Could not find the end of loading-bar CSS; no changes saved.")

s = s[:start] + """.bootLoader {
    width: 76px;
    height: 76px;
    margin: 28px auto;
    border: 3px solid rgba(0,234,255,.12);
    border-top-color: #00eaff;
    border-right-color: #008cff;
    border-radius: 50%;
    box-shadow: 0 0 22px rgba(0,220,255,.15);
    animation: runeSpin 1s linear infinite;
}
@keyframes runeSpin {
    to { transform: rotate(360deg); }
}""" + s[end:]

replace_once(
'''        <div class="bootTrack">
            <div id="bootProgress"></div>
        </div>
        <div class="bootPercent" id="bootPercent">0%</div>''',
'''        <div class="bootLoader" role="img" aria-label="Rune is initializing"></div>''',
"loading-bar HTML"
)

replace_once(
'''initializeInterface();

/* Live clock and actual page-session uptime. */''',
'''/* Interface initialization is handled by bootRune(). */

/* Live clock and actual page-session uptime. */''',
"early initialization call"
)

replace_once(
'''function setBootProgress(percent, detail) {
    $("bootProgress").style.width = percent + "%";
    $("bootPercent").textContent = percent + "%";
    $("bootDetail").textContent = detail;
}''',
'''function setBootProgress(percent, detail) {
    $("bootDetail").textContent = detail;
}''',
"progress function"
)

replace_once(
'''        $("uiStatus").textContent = "READY";
        $("sessionStatus").textContent = "ACTIVE";
        $("systemBadge").textContent = "AGENT READY";

        log("Agent initialization completed.", "ok");''',
'''        $("uiStatus").textContent = "UI READY";
        $("sessionStatus").textContent = "LOCAL MODULE LOADED";
        $("systemBadge").textContent = "AI NOT CONNECTED";

        log("Local module initialization completed.", "ok");
        log("AI engine is not connected.", "warn");''',
"ready status"
)

replace_once(
'''        setBootProgress(100, "Rune is ready");''',
'''        setBootProgress(100, "Local module initialized");''',
"success detail"
)

replace_once(
'''        $("bootLabel").textContent = "INITIALIZATION COMPLETE";''',
'''        $("bootLabel").textContent = "LOCAL MODULE INITIALIZED";''',
"success label"
)

replace_once(
'''            "RUNE IS READY",
            "Waiting for your input"''',
'''            "INTERFACE READY",
            "AI engine not connected"''',
"core status"
)

replace_once(
'''        $("bootProgress").style.width = "100%";
        $("bootProgress").style.background = "#ff6478";''',
'''        $("bootDetail").textContent = "Initialization stopped";''',
"failure progress"
)

p.write_text(s)
print("Rune V4.1 patch applied.")
