export async function initializeAgent() {
    // Verify that the browser supports the APIs Rune needs.
    const checks = {
        browser: true,
        audio: Boolean(
            window.AudioContext || window.webkitAudioContext
        ),
        microphone: Boolean(
            navigator.mediaDevices?.getUserMedia
        ),
        speechRecognition: Boolean(
            window.SpeechRecognition || window.webkitSpeechRecognition
        ),
        speechSynthesis: "speechSynthesis" in window,
        streaming: Boolean(
            typeof ReadableStream === "function" &&
            typeof TextDecoder === "function"
        ),
        browserAI: Boolean(
            window.LanguageModel || window.ai?.languageModel
        )
    };

    return {
        name: "Rune",
        version: "0.5.0",
        initialized: true,
        checks,
        initializedAt: new Date().toISOString()
    };
}
