import { Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ToolCallCard } from "./tool-call-card";
import { ThinkingIndicator } from "./thinking-indicator";
import type { ToolCallInfo, PlanInfo } from "@/hooks/use-stream-chat";
import { PlanCard } from "./plan-card";

interface StreamingMessageProps {
  text: string;
  toolCalls: ToolCallInfo[];
  thinkingMessage: string | null;
  isStreaming: boolean;
  model?: string;
  provider?: string;
  plan?: PlanInfo;
}

export function StreamingMessage({
  text,
  toolCalls,
  thinkingMessage,
  isStreaming,
  model,
  provider,
  plan,
}: StreamingMessageProps) {
  const hasContent = text || toolCalls.length > 0 || thinkingMessage;
  if (!hasContent) return null;

  // If we only have a thinking message and no other content, show the indicator
  if (!text && toolCalls.length === 0 && thinkingMessage) {
    return <ThinkingIndicator message={thinkingMessage} />;
  }

  return (
    <div className="flex gap-3 animate-slide-up">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary">
        <Bot className="h-4 w-4 text-primary-foreground" />
      </div>
      <div className="max-w-[75%] rounded-lg bg-muted px-4 py-2 text-sm">
        {toolCalls.length > 0 && (
          <div className="mb-2">
            {toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} tool={tc} />
            ))}
          </div>
        )}
        {thinkingMessage && !text && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            {thinkingMessage}
          </div>
        )}
        {text && (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{text}</ReactMarkdown>
            {isStreaming && (
              <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground ml-0.5" />
            )}
          </div>
        )}
        {plan && <PlanCard plan={plan} />}
        {model && !isStreaming && (
          <p className="mt-1 text-xs opacity-60">
            {model}
            {provider && ` via ${provider}`}
          </p>
        )}
      </div>
    </div>
  );
}
