import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { useStreamChat } from "@/hooks/use-stream-chat";
import { useDashboardUser, useConversationMessages, useConversations } from "@/api/queries";
import { useAcceptSuggestion } from "@/api/mutations";
import { StreamingMessage } from "@/components/chat/streaming-message";
import { PlanCard } from "@/components/chat/plan-card";
import { SuggestionChips } from "@/components/chat/suggestion-chips";
import { VoiceRing, type RingState } from "@/components/chat/voice-ring";
import { VoiceModeOverlay } from "@/components/chat/voice-mode-overlay";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";
import { useCommandCenter } from "@/providers/command-center-provider";
import { useAutoHighlight } from "@/hooks/use-auto-highlight";
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
  Plus,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: string;
  provider?: string;
  plan?: PlanInfo;
  suggestions?: string[];
  toolCalls?: ToolCallInfo[];
}

const CONVERSATION_STORAGE_KEY = "ai-cofounder-conversation-id";

const quickActions = [
  { label: "What's the status?", icon: BarChart3 },
  { label: "Create a plan", icon: Zap },
  { label: "Search my memories", icon: MessageSquare },
  { label: "Run monitoring check", icon: Sparkles },
];

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(CONVERSATION_STORAGE_KEY) || undefined,
  );
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [showConvPicker, setShowConvPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: dashboardUser } = useDashboardUser();
  const { data: conversations } = useConversations(dashboardUser?.id);
  const stream = useStreamChat();
  const acceptSuggestion = useAcceptSuggestion();
  const speech = useSpeechRecognition();
  const tts = useTextToSpeech();
  const { chatPrefill, clearChatPrefill } = useCommandCenter();
  useAutoHighlight(stream.richCards);

  // Consume prefill from cross-panel communication
  useEffect(() => {
    if (chatPrefill) {
      setInput(chatPrefill);
      clearChatPrefill();
      inputRef.current?.focus();
    }
  }, [chatPrefill, clearChatPrefill]);

  // Load conversation history
  const { data: historyData } = useConversationMessages(conversationId);
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
    if (conversationId) localStorage.setItem(CONVERSATION_STORAGE_KEY, conversationId);
    else localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  }, [conversationId]);

  // Auto-scroll
  useEffect(() => {
    if (!showScrollButton) scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stream.accumulatedText, stream.toolCalls, showScrollButton]);

  // Finalize streaming message
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
        if (stream.conversationId) setConversationId(stream.conversationId);
        if (tts.autoSpeak && stream.accumulatedText) tts.speak(stream.accumulatedText);
        stream.reset();
      }
    }
    prevStreaming.current = stream.isStreaming;
    // Intentionally only watches stream.isStreaming transitions; including
    // stream/tts would re-run on every render and duplicate finalization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.isStreaming]);

  // Stream error
  useEffect(() => {
    if (stream.error && stream.error !== "Cancelled") {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${stream.error}` }]);
      stream.reset();
    }
    // Only re-run when error changes; stream is a stable object from the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.error]);

  // Speech transcript
  const lastTranscript = useRef("");
  useEffect(() => {
    if (!speech.isListening && speech.transcript && speech.transcript !== lastTranscript.current) {
      lastTranscript.current = speech.transcript;
      handleSend(speech.transcript);
    }
    // handleSend is intentionally not a dep to avoid re-firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.isListening, speech.transcript]);

  const ringState: RingState = useMemo(() => {
    if (speech.error) return "error";
    if (tts.isSpeaking) return "speaking";
    if (speech.isListening) return "listening";
    if (stream.isStreaming && stream.accumulatedText) return "streaming";
    if (stream.isStreaming) return "thinking";
    return "idle";
  }, [
    speech.error,
    tts.isSpeaking,
    speech.isListening,
    stream.isStreaming,
    stream.accumulatedText,
  ]);

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
    tts.stop();
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    if (!text) setInput("");
    stream.sendMessage(trimmed, conversationId, dashboardUser?.id);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    acceptSuggestion.mutate({ suggestion, userId: dashboardUser?.id });
    handleSend(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        handleNewChat();
      }
      if (e.key === "Escape" && stream.isStreaming) stream.cancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // handleNewChat / stream.cancel are stable; only rebind on isStreaming changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setShowConvPicker(false);
  };

  const handleMicClick = () => {
    if (speech.isListening) speech.stopListening();
    else {
      tts.stop();
      speech.startListening();
    }
  };

  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  const renderedMessages = useMemo(
    () =>
      messages.flatMap((msg, i) => {
        const elements = [
          <div
            key={i}
            className={`flex gap-3 chat-message-enter ${msg.role === "user" ? "justify-end" : ""}`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/20">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
            )}
            <div
              className={`max-w-[85%] px-3 py-2 text-sm shadow-sm ${
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
                <p className="mt-1 text-[10px] opacity-50">
                  {msg.model}
                  {msg.provider && ` via ${msg.provider}`}
                </p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>,
        ];
        if (i === lastAssistantIndex && msg.suggestions?.length && !stream.isStreaming) {
          elements.push(
            <SuggestionChips
              key={`s-${i}`}
              suggestions={msg.suggestions}
              onSelect={handleSuggestionSelect}
            />,
          );
        }
        return elements;
      }),
    // handleSuggestionSelect is stable within render and omitted intentionally
    // to avoid re-rendering the full message list on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, lastAssistantIndex, stream.isStreaming],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Compact header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0">
        {/* Conversation picker */}
        <div className="relative">
          <button
            onClick={() => setShowConvPicker(!showConvPicker)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            <span className="truncate max-w-[120px]">
              {conversationId ? conversationId.slice(0, 8) + "..." : "New chat"}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showConvPicker && (
            <div className="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg border bg-popover shadow-lg">
              <div className="p-1">
                <button
                  onClick={handleNewChat}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                >
                  <Plus className="h-3 w-3" /> New Chat
                </button>
                {conversations?.data?.slice(0, 10).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectConversation(c.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent truncate"
                  >
                    {c.id.slice(0, 8)}...
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {tts.isAvailable && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => tts.setAutoSpeak(!tts.autoSpeak)}
              className={tts.autoSpeak ? "text-green-400" : "text-muted-foreground"}
              title={tts.autoSpeak ? "Auto-speak on" : "Auto-speak off"}
            >
              {tts.autoSpeak ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            </Button>
          )}
          {speech.isSupported && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setVoiceMode(true)}
              title="Voice mode"
            >
              <Expand className="h-3 w-3" />
            </Button>
          )}
          {stream.isStreaming && (
            <Button variant="ghost" size="icon-sm" onClick={stream.cancel} title="Cancel">
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}>
        {messages.length === 0 && !stream.isStreaming ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-xs px-4">
              <div className="relative mx-auto mb-4 h-12 w-12">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 blur-xl" />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500">
                  <Bot className="h-6 w-6 text-white" />
                </div>
              </div>
              <h3 className="text-sm font-medium mb-1">What can I help with?</h3>
              <div className="grid grid-cols-2 gap-1.5 mt-3">
                {quickActions.map(({ label, icon: Icon }) => (
                  <button
                    key={label}
                    onClick={() => handleSend(label)}
                    className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/50 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-all hover:border-purple-500/30 hover:text-foreground"
                  >
                    <Icon className="h-3 w-3 shrink-0 text-purple-400" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-3">
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
            className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full border bg-card px-2 py-1 text-[10px] shadow-md hover:bg-accent"
          >
            <ChevronDown className="inline h-3 w-3 mr-0.5" />
            New messages
          </button>
        )}
      </div>

      {/* Input */}
      <div className="mx-2 mb-2 flex items-end gap-1.5 rounded-xl border border-border/50 bg-muted/30 p-1.5 transition-all focus-within:border-purple-500/30 focus-within:shadow-[0_0_15px_rgba(124,58,237,0.1)] shrink-0">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 min-h-[32px] text-sm"
          disabled={stream.isStreaming}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          {speech.isSupported && (
            <Button
              variant="ghost"
              size="icon-sm"
              className={
                speech.isListening
                  ? "bg-purple-500 text-white hover:bg-purple-600"
                  : "text-muted-foreground"
              }
              onClick={handleMicClick}
              disabled={stream.isStreaming}
            >
              <Mic className="h-3.5 w-3.5" />
            </Button>
          )}
          {speech.isListening && <VoiceRing state="listening" size="sm" />}
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || stream.isStreaming}
            size="icon-sm"
            className="rounded-full"
          >
            {stream.isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
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
