export async function initializeAgent() {
    // Verify that the browser supports the APIs Rune needs.
    const checks = {
        browser: true,
        audio: Boolean(
            window.AudioContext || window.webkitAudioContext
        ),
        microphone: Boolean(
            navigator.mediaDevices?.getUserMedia
        )
    };

    return {
        name: "Rune",
        version: "0.4.0",
        initialized: true,
        checks,
        initializedAt: new Date().toISOString()
    };
}
