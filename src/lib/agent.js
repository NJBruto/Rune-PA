/* Browser capability probe. Runs entirely in the browser. */

export async function initializeAgent() {
    const checks = {
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
        ),
        webgpu: Boolean(navigator.gpu)
    };

    return {
        name: "Rune",
        version: "0.6.0",
        initialized: true,
        checks,
        initializedAt: new Date().toISOString()
    };
}
