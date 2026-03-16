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
import { VoiceRing, type RingState } from "@/components/chat/voice-ring";
import { VoiceModeOverlay } from "@/components/chat/voice-mode-overlay";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";
import type { PlanInfo, ToolCallInfo } from "@/hooks/use-stream-chat";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  X,
  Mic,
  Volume2,
  VolumeX,
  Expand,
  Sparkles,
  MessageSquare,
  Zap,
  BarChart3,
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

const quickActions = [
  { label: "What's the status?", icon: BarChart3 },
  { label: "Create a plan", icon: Zap },
  { label: "Search my memories", icon: MessageSquare },
  { label: "Run monitoring check", icon: Sparkles },
];

export function ChatPage() {
  usePageTitle("Chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(CONVERSATION_STORAGE_KEY) || undefined,
  );
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: dashboardUser } = useDashboardUser();
  const stream = useStreamChat();
  const acceptSuggestion = useAcceptSuggestion();
  const speech = useSpeechRecognition();
  const tts = useTextToSpeech();

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

  // Track streaming completion — finalize message + auto-speak
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (prevStreaming.current && !stream.isStreaming && !stream.error) {
      if (stream.accumulatedText || stream.toolCalls.length > 0) {
        const finalText = stream.accumulatedText;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: finalText,
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
        // Auto-speak when enabled
        if (tts.autoSpeak && finalText) {
          tts.speak(finalText);
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

  // Send speech transcript when recognition completes (final result)
  const lastTranscript = useRef("");
  useEffect(() => {
    if (
      !speech.isListening &&
      speech.transcript &&
      speech.transcript !== lastTranscript.current
    ) {
      lastTranscript.current = speech.transcript;
      handleSend(speech.transcript);
    }
  }, [speech.isListening, speech.transcript]);

  // Derive ring state from current activity
  const ringState: RingState = useMemo(() => {
    if (speech.error) return "error";
    if (tts.isSpeaking) return "speaking";
    if (speech.isListening) return "listening";
    if (stream.isStreaming && stream.accumulatedText) return "streaming";
    if (stream.isStreaming) return "thinking";
    return "idle";
  }, [speech.error, tts.isSpeaking, speech.isListening, stream.isStreaming, stream.accumulatedText]);

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

    tts.stop(); // Stop speaking when sending new message
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

  const handleMicClick = () => {
    if (speech.isListening) {
      speech.stopListening();
    } else {
      tts.stop();
      speech.startListening();
    }
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
            className={`flex gap-3 chat-message-enter ${
              msg.role === "user" ? "justify-end" : ""
            }`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/20">
                <Bot className="h-4 w-4 text-white" />
              </div>
            )}
            <div
              className={`max-w-[75%] px-4 py-2.5 text-sm shadow-sm ${
                msg.role === "user"
                  ? "rounded-2xl rounded-tr-sm bg-primary text-primary-foreground"
                  : "rounded-2xl rounded-tl-sm bg-muted"
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
                <p className="mt-1.5 text-xs opacity-50">
                  {msg.model}
                  {msg.provider && ` via ${msg.provider}`}
                </p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
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
            <div className="flex items-center gap-2">
              {tts.isAvailable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => tts.setAutoSpeak(!tts.autoSpeak)}
                  className={tts.autoSpeak ? "text-green-400" : "text-muted-foreground"}
                  title={tts.autoSpeak ? "Auto-speak on" : "Auto-speak off"}
                >
                  {tts.autoSpeak ? (
                    <Volume2 className="h-4 w-4" />
                  ) : (
                    <VolumeX className="h-4 w-4" />
                  )}
                </Button>
              )}
              {speech.isSupported && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVoiceMode(true)}
                  title="Voice mode"
                >
                  <Expand className="h-4 w-4" />
                </Button>
              )}
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
              <div className="text-center max-w-md">
                <div className="relative mx-auto mb-6 h-16 w-16">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 blur-xl" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500">
                    <Bot className="h-8 w-8 text-white" />
                  </div>
                </div>
                <h2 className="text-lg font-medium text-foreground mb-2">
                  What can I help with?
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Chat with your AI Cofounder to plan, build, and monitor your projects.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {quickActions.map(({ label, icon: Icon }) => (
                    <button
                      key={label}
                      onClick={() => handleSend(label)}
                      className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/50 px-3 py-2.5 text-left text-sm text-muted-foreground transition-all hover:border-purple-500/30 hover:bg-muted hover:text-foreground"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-purple-400" />
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground/60">
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

        {/* Input area */}
        <div className="mt-3 flex items-end gap-2 rounded-2xl border border-border/50 bg-muted/30 p-2 transition-all focus-within:border-purple-500/30 focus-within:shadow-[0_0_20px_rgba(124,58,237,0.1)]">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 min-h-[36px]"
            disabled={stream.isStreaming}
          />
          <div className="flex items-center gap-1 shrink-0">
            {speech.isSupported && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 rounded-full ${
                  speech.isListening
                    ? "bg-purple-500 text-white hover:bg-purple-600"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={handleMicClick}
                disabled={stream.isStreaming}
                aria-label={speech.isListening ? "Stop listening" : "Start listening"}
              >
                <Mic className="h-4 w-4" />
              </Button>
            )}
            {speech.isListening && (
              <VoiceRing state="listening" size="sm" />
            )}
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || stream.isStreaming}
              size="icon"
              className="h-8 w-8 rounded-full"
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

      {/* Voice mode overlay */}
      {voiceMode && (
        <VoiceModeOverlay
          ringState={ringState}
          onClose={() => setVoiceMode(false)}
          onStartListening={speech.startListening}
          onStopListening={speech.stopListening}
          isListening={speech.isListening}
        />
      )}
    </div>
  );
}
