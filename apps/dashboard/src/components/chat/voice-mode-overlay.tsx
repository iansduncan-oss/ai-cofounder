import { useEffect, useCallback } from "react";
import { VoiceRing, type RingState } from "./voice-ring";
import { X } from "lucide-react";

const stateLabels: Record<RingState, string> = {
  idle: "Hold space or tap to speak",
  listening: "Listening...",
  thinking: "Thinking...",
  streaming: "Responding...",
  speaking: "Speaking...",
  error: "Error occurred",
};

interface VoiceModeOverlayProps {
  ringState: RingState;
  onClose: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  isListening: boolean;
}

export function VoiceModeOverlay({
  ringState,
  onClose,
  onStartListening,
  onStopListening,
  isListening,
}: VoiceModeOverlayProps) {
  // Spacebar hold-to-speak
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        onStartListening();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onStartListening, onClose],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        onStopListening();
      }
    },
    [onStopListening],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <button
        onClick={onClose}
        className="absolute top-6 right-6 rounded-full p-2 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Close voice mode"
      >
        <X className="h-6 w-6" />
      </button>

      <div
        className="cursor-pointer select-none"
        onMouseDown={(e) => {
          e.preventDefault();
          onStartListening();
        }}
        onMouseUp={onStopListening}
        onMouseLeave={() => {
          if (isListening) onStopListening();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          onStartListening();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          onStopListening();
        }}
      >
        <VoiceRing state={ringState} size="lg" />
      </div>

      <p className="mt-8 text-lg text-white/80 font-light">
        {stateLabels[ringState]}
      </p>
      <p className="mt-2 text-sm text-white/40">
        Press Escape to exit
      </p>
    </div>
  );
}
