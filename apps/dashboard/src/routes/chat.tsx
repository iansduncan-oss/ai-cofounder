import { useState, useRef, useEffect, useCallback } from "react";
import { useRunAgent } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  Target,
} from "lucide-react";

interface PlanInfo {
  goalId: string;
  goalTitle: string;
  tasks: Array<{
    id: string;
    title: string;
    assignedAgent: string;
    orderIndex: number;
  }>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: string;
  provider?: string;
  plan?: PlanInfo;
}

const CONVERSATION_STORAGE_KEY = "ai-cofounder-conversation-id";

function PlanCard({ plan }: { plan: PlanInfo }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-2 rounded-md border bg-background/50 p-3">
      <button
        className="flex w-full items-center gap-2 text-left text-xs font-medium"
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? "Collapse plan" : "Expand plan"}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Target className="h-3 w-3 text-primary" />
        <span>{plan.goalTitle}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-5">
          {plan.tasks
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((task, i) => (
              <div
                key={task.id}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                  {i + 1}
                </span>
                <span>{task.title}</span>
                <span className="ml-auto text-[10px] opacity-60">
                  {task.assignedAgent}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary">
        <Bot className="h-4 w-4 text-primary-foreground" />
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-muted px-4 py-2">
        <span
          className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce-dot"
          style={{ animationDelay: "0s" }}
        />
        <span
          className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce-dot"
          style={{ animationDelay: "0.16s" }}
        />
        <span
          className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce-dot"
          style={{ animationDelay: "0.32s" }}
        />
      </div>
    </div>
  );
}

export function ChatPage() {
  usePageTitle("Chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(CONVERSATION_STORAGE_KEY) || undefined,
  );
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const runAgent = useRunAgent();

  // Persist conversationId
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(CONVERSATION_STORAGE_KEY, conversationId);
    } else {
      localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    }
  }, [conversationId]);

  // Auto-scroll
  useEffect(() => {
    if (!showScrollButton) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showScrollButton]);

  // Track scroll position for scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollButton(!isNearBottom && messages.length > 0);
  }, [messages.length]);

  const scrollToBottom = () => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollButton(false);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || runAgent.isPending) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    runAgent.mutate(
      { message: trimmed, conversationId, userId: "dashboard-user" },
      {
        onSuccess: (result) => {
          setConversationId(result.conversationId);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: result.response,
              model: result.model,
              provider: result.provider,
              plan: result.plan,
            },
          ]);
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Error: ${err.message}`,
            },
          ]);
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageHeader
        title="Chat"
        description={
          conversationId
            ? `Conversation: ${conversationId.slice(0, 8)}...`
            : "Start a conversation with the orchestrator"
        }
        actions={
          conversationId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConversationId(undefined);
                setMessages([]);
              }}
            >
              New Chat
            </Button>
          ) : undefined
        }
      />

      <div
        ref={containerRef}
        className="relative flex-1 overflow-y-auto rounded-lg border bg-card"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Bot className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Send a message to start chatting with the AI Cofounder
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 animate-slide-up ${
                  msg.role === "user" ? "justify-end" : ""
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary">
                    <Bot className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {msg.plan && <PlanCard plan={msg.plan} />}
                  {msg.model && (
                    <p className="mt-1 text-xs opacity-60">
                      {msg.model}
                      {msg.provider && ` via ${msg.provider}`}
                    </p>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
            {runAgent.isPending && <TypingIndicator />}
            <div ref={scrollRef} />
          </div>
        )}

        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-md transition-colors hover:bg-accent"
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="inline h-3 w-3 mr-1" />
            New messages
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="resize-none"
          disabled={runAgent.isPending}
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || runAgent.isPending}
          className="self-end"
          aria-label="Send message"
        >
          {runAgent.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
