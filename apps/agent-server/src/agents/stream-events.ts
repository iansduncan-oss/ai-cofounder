export type StreamEventType = "thinking" | "tool_call" | "tool_result" | "text_delta" | "done" | "error";

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
}

export type StreamCallback = (event: StreamEvent) => void | Promise<void>;
