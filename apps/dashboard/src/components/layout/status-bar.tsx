import { useRealtime } from "@/providers/realtime-provider";
import { useHealth } from "@/api/queries";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, Activity } from "lucide-react";

interface StatusBarProps {
  isStreaming?: boolean;
}

export function StatusBar({ isStreaming }: StatusBarProps) {
  const { status } = useRealtime();
  const { data: health } = useHealth();

  return (
    <div className="flex items-center justify-between border-t bg-surface-1 px-3 py-1 text-[10px] text-muted-foreground shrink-0">
      {/* Left: WS status */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {status === "connected" ? (
            <Wifi className="h-2.5 w-2.5 text-emerald-500" />
          ) : (
            <WifiOff className="h-2.5 w-2.5 text-amber-500" />
          )}
          <span>{status === "connected" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}</span>
        </div>
        {isStreaming && (
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-glow-pulse" />
            <span>Streaming</span>
          </div>
        )}
      </div>

      {/* Center: Health */}
      <div className="flex items-center gap-1">
        <div
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            health?.status === "ok" ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
        <span>{health?.status === "ok" ? "All systems nominal" : "Checking..."}</span>
      </div>

      {/* Right: Keyboard hints */}
      <div className="hidden md:flex items-center gap-2">
        <kbd className="rounded border bg-muted px-1 py-0.5 text-[9px]">⌘K</kbd>
        <span>Quick nav</span>
      </div>
    </div>
  );
}
