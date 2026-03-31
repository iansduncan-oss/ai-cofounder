import { useState, useRef, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { VoiceRing, type RingState } from "@/components/chat/voice-ring";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";
import { useStreamChat } from "@/hooks/use-stream-chat";
import { usePageTitle } from "@/hooks/use-page-title";
import { useConversationMessages, useListPersonas, useActivePersona } from "@/api/queries";
import { Bot, User, Mic, Volume2, VolumeX, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: string;
  provider?: string;
}

const VOICE_CONVERSATION_KEY = "ai-cofounder-voice-conversation-id";

export function VoicePage() {
  usePageTitle("Voice");

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(VOICE_CONVERSATION_KEY) ?? undefined,
  );
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTranscriptRef = useRef("");
  const spaceHeldRef = useRef(false);

  const speech = useSpeechRecognition();
  const tts = useTextToSpeech();
  const stream = useStreamChat();
  const { data: historyData } = useConversationMessages(conversationId);
  const { data: personasData } = useListPersonas();
  const { data: activePersonaData } = useActivePersona();

  const personas = personasData?.personas ?? [];
  const activePersona = activePersonaData?.persona;

  // Load conversation history
  useEffect(() => {
    if (!historyData?.data) return;
    const loaded: Message[] = historyData.data.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
    }));
    setMessages(loaded);
  }, [historyData]);

  // Auto-scroll on new messages or streaming text
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, stream.accumulatedText]);

  // Compute ring state
  const ringState: RingState = stream.error
    ? "error"
    : speech.isListening
      ? "listening"
      : stream.isStreaming && !stream.accumulatedText
        ? "thinking"
        : stream.isStreaming
          ? "streaming"
          : tts.isSpeaking
            ? "speaking"
            : "idle";

  // Handle sending a message
  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      tts.stop();

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      await stream.sendMessage(text, conversationId);
    },
    [conversationId, stream, tts],
  );

  // When speech recognition returns a transcript and stops listening
  useEffect(() => {
    if (
      !speech.isListening &&
      speech.transcript &&
      speech.transcript !== prevTranscriptRef.current
    ) {
      prevTranscriptRef.current = speech.transcript;
      handleSend(speech.transcript);
    }
  }, [speech.isListening, speech.transcript, handleSend]);

  // When streaming completes, add assistant message and auto-speak
  useEffect(() => {
    if (!stream.isStreaming && stream.accumulatedText) {
      const finalText = stream.accumulatedText;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: finalText,
          model: stream.model,
          provider: stream.provider,
        },
      ]);

      // Update conversation ID
      if (stream.conversationId && stream.conversationId !== conversationId) {
        setConversationId(stream.conversationId);
        localStorage.setItem(VOICE_CONVERSATION_KEY, stream.conversationId);
      }

      // Auto-speak response
      if (tts.isAvailable && tts.autoSpeak) {
        tts.speak(finalText);
      }

      stream.reset();
    }
  }, [stream.isStreaming, stream.accumulatedText, stream, conversationId, tts]);

  // Toggle listening on ring click
  const handleRingClick = useCallback(() => {
    if (speech.isListening) {
      speech.stopListening();
    } else if (stream.isStreaming) {
      stream.cancel();
    } else if (tts.isSpeaking) {
      tts.stop();
    } else {
      tts.stop();
      speech.startListening();
    }
  }, [speech, stream, tts]);

  // Spacebar hold-to-speak
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !spaceHeldRef.current && e.target === document.body) {
        e.preventDefault();
        spaceHeldRef.current = true;
        if (!speech.isListening && !stream.isStreaming) {
          tts.stop();
          speech.startListening();
        }
      }
      if (e.code === "Escape") {
        if (stream.isStreaming) stream.cancel();
        if (tts.isSpeaking) tts.stop();
        if (speech.isListening) speech.stopListening();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        if (speech.isListening) speech.stopListening();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [speech, stream, tts]);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    localStorage.removeItem(VOICE_CONVERSATION_KEY);
    stream.reset();
    prevTranscriptRef.current = "";
  }, [stream]);

  const statusText = (() => {
    if (stream.error) return stream.error;
    if (speech.error) return `Mic error: ${speech.error}`;
    if (speech.isListening) return speech.transcript || "Listening...";
    if (stream.isStreaming && stream.thinkingMessage) return stream.thinkingMessage;
    if (stream.isStreaming && !stream.accumulatedText) return "Thinking...";
    if (stream.isStreaming) return "Responding...";
    if (tts.isSpeaking) return "Speaking...";
    return "Tap the ring or hold Space to speak";
  })();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Voice"
        description="Talk to your AI cofounder"
        actions={
          <div className="flex items-center gap-2">
            {/* Persona selector */}
            {personas.length > 0 && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPersonaMenuOpen(!personaMenuOpen)}
                  className="gap-1"
                >
                  <Bot className="h-3.5 w-3.5" />
                  {activePersona?.name ?? "Default"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {personaMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-md border bg-popover p-1 shadow-md">
                    {personas.map((p) => (
                      <button
                        key={p.id}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => setPersonaMenuOpen(false)}
                      >
                        <Bot className="h-3.5 w-3.5 opacity-50" />
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Auto-speak toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => tts.setAutoSpeak(!tts.autoSpeak)}
              title={tts.autoSpeak ? "Disable auto-speak" : "Enable auto-speak"}
            >
              {tts.autoSpeak ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </Button>

            {/* New conversation */}
            <Button variant="outline" size="sm" onClick={handleNewConversation}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>
        }
      />

      <div className="flex-1 flex flex-col items-center min-h-0">
        {/* Voice Ring — primary interaction */}
        <div className="flex flex-col items-center justify-center py-8 shrink-0">
          <button
            onClick={handleRingClick}
            className="cursor-pointer focus:outline-none"
            aria-label={speech.isListening ? "Stop listening" : "Start listening"}
          >
            <VoiceRing state={ringState} size="lg" />
          </button>

          <p className="mt-4 text-sm text-muted-foreground text-center max-w-xs min-h-[1.25rem]">
            {statusText}
          </p>

          {!speech.isSupported && (
            <p className="mt-2 text-xs text-destructive">
              Speech recognition is not supported in this browser
            </p>
          )}

          {speech.isListening && speech.transcript && (
            <div className="mt-3 px-4 py-2 rounded-lg bg-primary/10 text-sm max-w-md text-center">
              {speech.transcript}
            </div>
          )}
        </div>

        {/* Streaming indicator */}
        {stream.isStreaming && stream.accumulatedText && (
          <div className="w-full max-w-2xl px-4 mb-4 shrink-0">
            <div className="flex gap-3 p-3 rounded-lg bg-muted/50">
              <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{stream.accumulatedText}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Transcript panel */}
        <div
          ref={scrollRef}
          className="flex-1 w-full max-w-2xl overflow-y-auto px-4 pb-4 min-h-0"
        >
          {messages.length === 0 && !stream.isStreaming && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Mic className="h-8 w-8 mb-3 opacity-30" />
              <p className="text-sm">No messages yet. Tap the ring or hold Space to start talking.</p>
            </div>
          )}

          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className="flex gap-3 items-start">
                {msg.role === "user" ? (
                  <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                ) : (
                  <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.model && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {msg.provider} · {msg.model}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
