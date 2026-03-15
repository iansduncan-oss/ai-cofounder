import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { usePageTitle } from "@/hooks/use-page-title";
import { useStreamChat } from "@/hooks/use-stream-chat";
import { useDashboardUser, useConversationMessages } from "@/api/queries";
import { useAcceptSuggestion } from "@/api/mutations";
import { StreamingMessage } from "@/components/chat/streaming-message";
import { PlanCard } from "@/components/chat/plan-card";
import { SuggestionChips } from "@/components/chat/suggestion-chips";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import type { PlanInfo, ToolCallInfo } from "@/hooks/use-stream-chat";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  X,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: string;
  provider?: string;
  plan?: PlanInfo;
  suggestions?: string[];
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
  thinkingPhase?: string;
}

const CONVERSATION_STORAGE_KEY = "ai-cofounder-conversation-id";

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

  const { data: dashboardUser } = useDashboardUser();
  const stream = useStreamChat();
  const acceptSuggestion = useAcceptSuggestion();

  // Load conversation history from backend
  const { data: historyData } = useConversationMessages(conversationId);

  // Populate messages from history on mount / conversation switch
  const historyLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!historyData?.data || !conversationId) return;
    if (historyLoaded.current === conversationId) return;
    historyLoaded.current = conversationId;

    const loaded: Message[] = historyData.data
      .slice()
      .reverse()
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    setMessages(loaded);
  }, [historyData, conversationId]);

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
  }, [messages, stream.accumulatedText, stream.toolCalls, showScrollButton]);

  // Track streaming completion — finalize message
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (prevStreaming.current && !stream.isStreaming && !stream.error) {
      if (stream.accumulatedText || stream.toolCalls.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: stream.accumulatedText,
            model: stream.model,
            provider: stream.provider,
            plan: stream.plan,
            suggestions: stream.suggestions,
            toolCalls: stream.toolCalls.length > 0 ? stream.toolCalls : undefined,
          },
        ]);
        if (stream.conversationId) {
          setConversationId(stream.conversationId);
        }
        stream.reset();
      }
    }
    prevStreaming.current = stream.isStreaming;
  }, [stream.isStreaming]);

  // Handle stream error — show as message
  useEffect(() => {
    if (stream.error && stream.error !== "Cancelled") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${stream.error}` },
      ]);
      stream.reset();
    }
  }, [stream.error]);

  // Track scroll position
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

  const handleSend = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || stream.isStreaming) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    if (!text) setInput("");

    stream.sendMessage(trimmed, conversationId, dashboardUser?.id);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    acceptSuggestion.mutate({
      suggestion,
      userId: dashboardUser?.id,
    });
    handleSend(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Cmd+N for new chat, Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        handleNewChat();
      }
      if (e.key === "Escape" && stream.isStreaming) {
        stream.cancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [stream.isStreaming]);

  const handleNewChat = () => {
    setConversationId(undefined);
    setMessages([]);
    historyLoaded.current = null;
    stream.reset();
  };

  const handleSelectConversation = (id: string) => {
    if (id === conversationId) return;
    historyLoaded.current = null;
    setConversationId(id);
    setMessages([]);
    stream.reset();
  };

  // Find the index of the last assistant message for suggestion chip rendering
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  // Memoize the rendering of static messages
  const renderedMessages = useMemo(
    () =>
      messages.flatMap((msg, i) => {
        const elements = [
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
          </div>,
        ];

        // Show suggestion chips only on the last assistant message
        if (
          i === lastAssistantIndex &&
          msg.suggestions &&
          msg.suggestions.length > 0 &&
          !stream.isStreaming
        ) {
          elements.push(
            <SuggestionChips
              key={`suggestions-${i}`}
              suggestions={msg.suggestions}
              onSelect={handleSuggestionSelect}
            />,
          );
        }

        return elements;
      }),
    [messages, lastAssistantIndex, stream.isStreaming],
  );

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <ConversationSidebar
        userId={dashboardUser?.id}
        activeConversationId={conversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
      />

      <div className="flex flex-1 flex-col">
        <PageHeader
          title="Chat"
          description={
            conversationId
              ? `Conversation: ${conversationId.slice(0, 8)}...`
              : "Start a conversation with the orchestrator"
          }
          actions={
            <div className="flex gap-2">
              {stream.isStreaming && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={stream.cancel}
                >
                  <X className="mr-1 h-3 w-3" />
                  Cancel
                </Button>
              )}
              {conversationId && (
                <Button variant="outline" size="sm" onClick={handleNewChat}>
                  New Chat
                </Button>
              )}
            </div>
          }
        />

        <div
          ref={containerRef}
          className="relative flex-1 overflow-y-auto rounded-lg border bg-card"
          onScroll={handleScroll}
        >
          {messages.length === 0 && !stream.isStreaming ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Bot className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Send a message to start chatting with the AI Cofounder
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cmd+N new chat · Escape cancel · Enter send
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {renderedMessages}

              {stream.isStreaming && (
                <StreamingMessage
                  text={stream.accumulatedText}
                  toolCalls={stream.toolCalls}
                  thinkingMessage={stream.thinkingMessage}
                  isStreaming={stream.isStreaming}
                  model={stream.model}
                  provider={stream.provider}
                  plan={stream.plan}
                />
              )}

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
            disabled={stream.isStreaming}
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || stream.isStreaming}
            className="self-end"
            aria-label="Send message"
          >
            {stream.isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
