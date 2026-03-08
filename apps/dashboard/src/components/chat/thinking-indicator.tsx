import { Bot, Loader2 } from "lucide-react";

export function ThinkingIndicator({ message }: { message?: string | null }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary">
        <Bot className="h-4 w-4 text-primary-foreground" />
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {message || "Thinking..."}
        </span>
      </div>
    </div>
  );
}
