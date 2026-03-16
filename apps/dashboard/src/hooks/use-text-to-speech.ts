import { useState, useRef, useCallback, useEffect } from "react";

const TTS_AUTOSPEAK_KEY = "ai-cofounder-autospeak";

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/[*_#`~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

interface UseTextToSpeechReturn {
  isSpeaking: boolean;
  isAvailable: boolean;
  speak: (text: string) => Promise<void>;
  stop: () => void;
  autoSpeak: boolean;
  setAutoSpeak: (value: boolean) => void;
}

export function useTextToSpeech(): UseTextToSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [autoSpeak, setAutoSpeakState] = useState(
    () => localStorage.getItem(TTS_AUTOSPEAK_KEY) === "true",
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Check ElevenLabs availability on mount
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "test" }),
        });
        setTtsAvailable(res.ok);
      } catch {
        setTtsAvailable(false);
      }
    };
    check();
  }, []);

  const setAutoSpeak = useCallback((value: boolean) => {
    setAutoSpeakState(value);
    localStorage.setItem(TTS_AUTOSPEAK_KEY, String(value));
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speakBrowser = useCallback(
    (text: string) => {
      const synthesis = window.speechSynthesis;
      if (!synthesis) return;

      synthesis.cancel();
      const clean = stripMarkdown(text);
      if (!clean) return;

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.05;
      utterance.pitch = 0.95;

      const voices = synthesis.getVoices();
      const preferred = voices.find(
        (v) =>
          v.name.includes("Samantha") ||
          v.name.includes("Daniel") ||
          v.name.includes("Google UK English Male"),
      );
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      synthesis.speak(utterance);
    },
    [],
  );

  const speak = useCallback(
    async (text: string) => {
      stop();

      if (!ttsAvailable) {
        speakBrowser(text);
        return;
      }

      setIsSpeaking(true);
      try {
        const res = await fetch("/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          speakBrowser(text);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        };

        audio.onerror = () => {
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        };

        await audio.play();
      } catch {
        setIsSpeaking(false);
        speakBrowser(text);
      }
    },
    [ttsAvailable, stop, speakBrowser],
  );

  const isAvailable = ttsAvailable || !!window.speechSynthesis;

  return { isSpeaking, isAvailable, speak, stop, autoSpeak, setAutoSpeak };
}
