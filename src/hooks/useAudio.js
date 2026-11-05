import { useCallback, useEffect, useRef, useState } from "react";
import { timestamp } from "../lib/chatConfig.js";

const START_THRESHOLD = 0.025;
const RELEASE_THRESHOLD = 0.015;

export function useAudio({ log, setCoreStatus }) {
    const [micStatus, setMicStatus] = useState("OFF");
    const [micClass, setMicClass] = useState("stat-value");
    const [audioStatus, setAudioStatus] = useState("NOT STARTED");
    const [soundStatus, setSoundStatus] = useState("IDLE");
    const [outputStatus, setOutputStatus] = useState("LOCKED / UNKNOWN");
    const [noiseStatus, setNoiseStatus] = useState("UNCALIBRATED");
    const [detectionStatus, setDetectionStatus] = useState("INACTIVE");
    const [lastEvent, setLastEvent] = useState("NONE");
    const [footerMode, setFooterMode] = useState("STANDBY");
    const [listening, setListening] = useState(false);

    const coreWrapRef = useRef(null);
    const coreRef = useRef(null);
    const meterFillRef = useRef(null);
    const levelTextRef = useRef(null);
    const noiseStatusRef = useRef(null);

    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const streamRef = useRef(null);
    const sourceRef = useRef(null);
    const rafRef = useRef(null);
    const soundEnabledRef = useRef(false);

    const wakePlayedRef = useRef(false);
    const wakeQueuedRef = useRef(false);

    const noiseFloorRef = useRef(0);
    const calibratedRef = useRef(false);
    const calibrationSamplesRef = useRef([]);
    const calibrationStartRef = useRef(0);
    const smoothedRmsRef = useRef(0);
    const detectedRef = useRef(false);
    const aboveCountRef = useRef(0);
    const belowCountRef = useRef(0);

    const tryWakeSound = useCallback(async (isStartup = false) => {
        if (wakePlayedRef.current) return;

        try {
            if (!audioContextRef.current) {
                const AudioCtor =
                    window.AudioContext || window.webkitAudioContext;

                if (!AudioCtor) {
                    setOutputStatus("UNSUPPORTED");
                    return;
                }

                audioContextRef.current = new AudioCtor();
            }

            const context = audioContextRef.current;

            if (context.state !== "running") {
                // Browsers can leave resume() pending forever when autoplay
                // is blocked. Never let startup wait on that promise.
                await Promise.race([
                    context.resume().catch(() => {}),
                    new Promise(resolve => setTimeout(resolve, 700))
                ]);
            }

            if (context.state !== "running") {
                wakeQueuedRef.current = true;
                setOutputStatus("AWAITING INTERACTION");
                return;
            }

            const now = context.currentTime;

            function tone(frequency, start, duration, volume) {
                const oscillator = context.createOscillator();
                const gain = context.createGain();

                oscillator.type = "sine";
                oscillator.frequency.setValueAtTime(
                    frequency,
                    now + start
                );

                gain.gain.setValueAtTime(0.0001, now + start);
                gain.gain.exponentialRampToValueAtTime(
                    volume,
                    now + start + 0.045
                );
                gain.gain.exponentialRampToValueAtTime(
                    0.0001,
                    now + start + duration
                );

                oscillator.connect(gain);
                gain.connect(context.destination);

                oscillator.start(now + start);
                oscillator.stop(now + start + duration + 0.02);
            }

            tone(440, 0.0, 0.22, 0.075);
            tone(587.33, 0.19, 0.26, 0.065);
            tone(783.99, 0.42, 0.42, 0.055);

            wakePlayedRef.current = true;
            wakeQueuedRef.current = false;

            setOutputStatus("ACTIVE");
            log(
                isStartup
                    ? "Startup chime scheduled."
                    : "Rune wake sound played.",
                "ok"
            );
        } catch (error) {
            wakeQueuedRef.current = true;
            setOutputStatus("AWAITING INTERACTION");
            console.info("Audio output requires interaction:", error);
        }
    }, [log]);

    const detectSound = useCallback(() => {
        if (!soundEnabledRef.current || !analyserRef.current) return;

        const analyser = analyserRef.current;
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);

        let sum = 0;

        for (let index = 0; index < data.length; index += 1) {
            sum += data[index] * data[index];
        }

        const rms = Math.sqrt(sum / data.length);

        if (!calibratedRef.current) {
            calibrationSamplesRef.current.push(rms);

            const elapsed = performance.now() - calibrationStartRef.current;

            if (elapsed < 1500) {
                if (noiseStatusRef.current) {
                    noiseStatusRef.current.textContent = "CALIBRATING";
                }
                setDetectionStatus("CALIBRATING");

                if (levelTextRef.current) {
                    levelTextRef.current.textContent =
                        Math.round(rms * 1000) / 10 + "%";
                }
                if (meterFillRef.current) {
                    meterFillRef.current.style.width =
                        Math.min(100, rms * 1000) + "%";
                }

                rafRef.current = requestAnimationFrame(detectSound);
                return;
            }

            const sorted = calibrationSamplesRef.current
                .slice()
                .sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);

            noiseFloorRef.current = sorted.length ? sorted[middle] : 0;
            calibratedRef.current = true;

            setNoiseStatus(
                (noiseFloorRef.current * 1000).toFixed(1) + " / 1000"
            );
            setDetectionStatus("ACTIVE");
            setCoreStatus("LISTENING", "Ambient sound calibrated");
            log("Ambient noise calibration completed.", "ok");
        }

        const smoothing = rms > smoothedRmsRef.current ? 0.38 : 0.12;
        smoothedRmsRef.current +=
            (rms - smoothedRmsRef.current) * smoothing;

        if (!detectedRef.current) {
            noiseFloorRef.current +=
                (smoothedRmsRef.current - noiseFloorRef.current) * 0.008;
        }

        const delta = Math.max(
            0,
            smoothedRmsRef.current - noiseFloorRef.current
        );

        const startThreshold = Math.max(
            START_THRESHOLD,
            noiseFloorRef.current * 2.8
        );
        const releaseThreshold = Math.max(
            RELEASE_THRESHOLD,
            noiseFloorRef.current * 1.7
        );

        const normalized = Math.min(1, delta * 9);
        const scale = 1 + normalized * 0.65;
        const glow = 1 + normalized * 1.8;
        const blur = 30 + normalized * 45;

        if (coreWrapRef.current) {
            coreWrapRef.current.style.transform = `scale(${scale})`;
        }
        if (coreRef.current) {
            coreRef.current.style.boxShadow = `
                0 0 ${12 * glow}px rgba(0,255,90,.95),
                0 0 ${blur}px rgba(0,255,90,.65),
                0 0 ${blur * 1.8}px rgba(0,255,90,.28)
            `;
        }

        const meter = Math.min(100, smoothedRmsRef.current * 1000);

        if (meterFillRef.current) {
            meterFillRef.current.style.width = meter + "%";
        }
        if (levelTextRef.current) {
            levelTextRef.current.textContent = meter.toFixed(1) + "%";
        }
        if (noiseStatusRef.current) {
            noiseStatusRef.current.textContent =
                (noiseFloorRef.current * 1000).toFixed(1) + " / 1000";
        }

        if (!detectedRef.current) {
            if (delta > startThreshold) {
                aboveCountRef.current += 1;
            } else {
                aboveCountRef.current = 0;
            }

            if (aboveCountRef.current >= 4) {
                detectedRef.current = true;
                aboveCountRef.current = 0;
                belowCountRef.current = 0;

                setSoundStatus("DETECTED");
                setDetectionStatus("SOUND ACTIVE");
                setLastEvent(timestamp());
                setCoreStatus(
                    "SOUND DETECTED",
                    "Input level above threshold"
                );
                log("Sound event detected by amplitude threshold.", "event");
            }
        } else if (delta < releaseThreshold) {
            belowCountRef.current += 1;

            if (belowCountRef.current >= 12) {
                detectedRef.current = false;
                belowCountRef.current = 0;
                aboveCountRef.current = 0;

                setSoundStatus("QUIET");
                setDetectionStatus("ACTIVE");
                setLastEvent(timestamp());
                setCoreStatus("LISTENING", "Awaiting sound input");
                log("Sound event ended; input returned to quiet.", "ok");
            }
        } else {
            belowCountRef.current = 0;
        }

        rafRef.current = requestAnimationFrame(detectSound);
    }, [log, setCoreStatus]);

    const stopMicrophone = useCallback(() => {
        soundEnabledRef.current = false;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        analyserRef.current = null;
        detectedRef.current = false;
        calibratedRef.current = false;
        calibrationSamplesRef.current = [];
        smoothedRmsRef.current = 0;

        if (coreWrapRef.current) {
            coreWrapRef.current.style.transform = "scale(1)";
        }
        if (coreRef.current) {
            coreRef.current.style.boxShadow = "";
        }
        if (meterFillRef.current) {
            meterFillRef.current.style.width = "0%";
        }
        if (levelTextRef.current) {
            levelTextRef.current.textContent = "0%";
        }

        setMicStatus("OFF");
        setMicClass("stat-value");
        setAudioStatus(
            audioContextRef.current &&
            audioContextRef.current.state !== "closed"
                ? audioContextRef.current.state.toUpperCase()
                : "STOPPED"
        );
        setSoundStatus("IDLE");
        setDetectionStatus("INACTIVE");
        setNoiseStatus("UNCALIBRATED");
        setFooterMode("STANDBY");
        setListening(false);

        setCoreStatus("SYSTEM READY", "Microphone disabled");
        log("Microphone stream stopped.", "warn");
    }, [log, setCoreStatus]);

    const startMicrophone = useCallback(async () => {
        if (soundEnabledRef.current) {
            stopMicrophone();
            return;
        }

        setMicStatus("CONNECTING...");
        setMicClass("stat-value yellow");
        setCoreStatus("MICROPHONE", "Requesting browser permission");
        log("Microphone permission requested.");

        try {
            const AudioCtor =
                window.AudioContext || window.webkitAudioContext;

            if (!AudioCtor) {
                throw new Error("Web Audio API is unavailable.");
            }

            if (
                !audioContextRef.current ||
                audioContextRef.current.state === "closed"
            ) {
                audioContextRef.current = new AudioCtor();
            }

            await Promise.race([
                audioContextRef.current.resume().catch(() => {}),
                new Promise(resolve => setTimeout(resolve, 1200))
            ]);

            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            streamRef.current = newStream;

            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.35;
            analyserRef.current = analyser;

            const source =
                audioContextRef.current.createMediaStreamSource(newStream);
            source.connect(analyser);
            sourceRef.current = source;

            soundEnabledRef.current = true;
            detectedRef.current = false;
            aboveCountRef.current = 0;
            belowCountRef.current = 0;
            smoothedRmsRef.current = 0;
            noiseFloorRef.current = 0;
            calibrationSamplesRef.current = [];
            calibrationStartRef.current = performance.now();
            calibratedRef.current = false;

            setMicStatus("ACTIVE");
            setMicClass("stat-value green");
            setAudioStatus("RUNNING");
            setDetectionStatus("CALIBRATING");
            setFooterMode("MICROPHONE ACTIVE");
            setListening(true);

            setCoreStatus("LISTENING", "Calibrating ambient sound");
            log("Microphone stream started.", "ok");
            log("Calibrating ambient noise for 1.5 seconds.");

            if (!wakePlayedRef.current) {
                await tryWakeSound(false);
            }

            detectSound();
        } catch (error) {
            console.error(error);

            log(
                "Microphone startup failed: " + error.message,
                "error"
            );

            setCoreStatus("MICROPHONE ERROR", "Check permission and browser");
            setMicStatus("UNAVAILABLE");
            setMicClass("stat-value red");
            setDetectionStatus("INACTIVE");
            setFooterMode("STANDBY");

            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }

            if (sourceRef.current) {
                sourceRef.current.disconnect();
                sourceRef.current = null;
            }

            soundEnabledRef.current = false;
            setListening(false);
        }
    }, [detectSound, log, setCoreStatus, stopMicrophone, tryWakeSound]);

    const playWakeSound = useCallback(async () => {
        wakePlayedRef.current = false;
        wakeQueuedRef.current = false;
        await tryWakeSound(false);

        if (!wakePlayedRef.current) {
            log("Wake sound could not be played yet.", "warn");
        }
    }, [log, tryWakeSound]);

    useEffect(() => {
        function unlockAudio() {
            if (!wakePlayedRef.current && wakeQueuedRef.current) {
                tryWakeSound(false);
            }
        }

        document.addEventListener("pointerdown", unlockAudio, { once: true });

        return () => {
            document.removeEventListener("pointerdown", unlockAudio);
        };
    }, [tryWakeSound]);

    useEffect(() => {
        function cleanup() {
            soundEnabledRef.current = false;

            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        }

        window.addEventListener("pagehide", cleanup);

        return () => {
            window.removeEventListener("pagehide", cleanup);
            cleanup();
        };
    }, []);

    return {
        micStatus,
        micClass,
        audioStatus,
        soundStatus,
        outputStatus,
        noiseStatus,
        noiseStatusRef,
        detectionStatus,
        lastEvent,
        footerMode,
        listening,
        coreWrapRef,
        coreRef,
        meterFillRef,
        levelTextRef,
        startMicrophone,
        stopMicrophone,
        playWakeSound,
        tryWakeSound
    };
}
