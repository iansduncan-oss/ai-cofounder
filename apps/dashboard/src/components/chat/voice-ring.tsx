export type RingState = "idle" | "listening" | "thinking" | "streaming" | "speaking" | "error";

interface VoiceRingProps {
  state: RingState;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-10 w-10",
  md: "h-20 w-20",
  lg: "h-30 w-30",
};

const innerSizeMap = {
  sm: "h-6 w-6",
  md: "h-14 w-14",
  lg: "h-20 w-20",
};

const stateStyles: Record<RingState, string> = {
  idle: "border-purple-500 shadow-[0_0_20px_rgba(124,58,237,0.4),inset_0_0_20px_rgba(124,58,237,0.1)]",
  listening:
    "border-purple-500 shadow-[0_0_40px_rgba(124,58,237,0.4),0_0_80px_rgba(124,58,237,0.2),inset_0_0_30px_rgba(124,58,237,0.15)] animate-[pulse-listen_1.5s_ease-in-out_infinite]",
  thinking:
    "border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.3),inset_0_0_20px_rgba(234,179,8,0.1)] animate-[spin-think_2s_linear_infinite]",
  streaming:
    "border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.4),inset_0_0_20px_rgba(59,130,246,0.1)] animate-[pulse-stream_1.2s_ease-in-out_infinite]",
  speaking:
    "border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.4),inset_0_0_25px_rgba(34,197,94,0.1)] animate-[pulse-speak_0.8s_ease-in-out_infinite]",
  error: "border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]",
};

export function VoiceRing({ state, size = "md" }: VoiceRingProps) {
  return (
    <div
      className={`rounded-full border-2 flex items-center justify-center transition-all duration-300 ${sizeMap[size]} ${stateStyles[state]}`}
    >
      <div
        className={`rounded-full bg-gradient-to-br from-[#13131a] to-[#0a0a0f] ${innerSizeMap[size]}`}
      />
    </div>
  );
}
