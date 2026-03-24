import { useState, useRef, useEffect, useCallback } from "react";
import { Send, X, MessageSquare } from "lucide-react";
import { useLocation } from "react-router";
import { useStreamChat } from "@/hooks/use-stream-chat";
import { useDashboardUser } from "@/api/queries";
import ReactMarkdown from "react-markdown";

const CONVERSATION_STORAGE_KEY = "ai-cofounder-conversation-id";

export function GlobalChatBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const stream = useStreamChat();
  const { data: dashboardUser } = useDashboardUser();

  // Hide on the full chat page
  if (location.pathname.includes("/chat")) return null;

  const conversationId = localStorage.getItem(CONVERSATION_STORAGE_KEY) || undefined;

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || stream.isStreaming) return;
    stream.sendMessage(trimmed, conversationId, dashboardUser?.id);
    setInput("");
    setOpen(true);
  }, [input, stream, conversationId, dashboardUser?.id]);

  // Cmd+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) {
          inputRef.current?.focus();
        } else {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      {/* Slide-over panel */}
      {open && (
        <div className="fixed bottom-14 right-4 z-50 w-96 max-h-80 rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <span className="text-xs font-medium text-muted-foreground">Quick Chat</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-sm">
            {stream.accumulatedText ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{stream.accumulatedText}</ReactMarkdown>
                {stream.isStreaming && <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground ml-0.5" />}
              </div>
            ) : stream.isStreaming ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                Thinking...
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Ask your AI Cofounder anything...</p>
            )}
          </div>
        </div>
      )}

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-14 right-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 py-2 flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask your cofounder... (⌘K)"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || stream.isStreaming}
          className="shrink-0 text-muted-foreground hover:text-purple-400 disabled:opacity-30 transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
        <span className="text-[10px] text-muted-foreground/40 hidden sm:inline">⌘K</span>
      </div>
    </>
  );
}
