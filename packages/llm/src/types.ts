/* ── Unified LLM types ── */

export interface LlmTextContent {
  type: "text";
  text: string;
}

export interface LlmToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export interface LlmThinkingContent {
  type: "thinking";
  thinking: string;
  /** Anthropic signature needed to round-trip thinking blocks in multi-turn conversations */
  signature?: string;
}

export type LlmContentBlock = LlmTextContent | LlmToolUseContent | LlmToolResultContent | LlmThinkingContent;

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContentBlock[];
}

export interface LlmToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: LlmToolParameter;
  properties?: Record<string, LlmToolParameter>;
  required?: string[];
}

export interface LlmTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, LlmToolParameter>;
    required: string[];
  };
  /** Optional precondition check — if provided and returns false, tool is filtered out before LLM sees it */
  preconditions?: () => boolean | Promise<boolean>;
}

/** Optional metadata passed through to onCompletion hook for usage attribution */
export interface CompletionMetadata {
  agentRole?: string;
  goalId?: string;
  taskId?: string;
  conversationId?: string;
  [key: string]: unknown;
}

export interface LlmCompletionRequest {
  model?: string;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  max_tokens?: number;
  temperature?: number;
  /** Enable extended thinking (Anthropic only). Budget is the max thinking tokens. */
  thinking?: { type: "enabled"; budget_tokens: number };
  /** Optional metadata passed through to onCompletion hook (ignored by LLM providers) */
  metadata?: CompletionMetadata;
  /** Optional callback for real-time text streaming (called with each text chunk as it arrives) */
  onTextDelta?: (text: string) => void;
}

export interface LlmCompletionResponse {
  content: LlmContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "unknown";
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Tokens written to the prompt cache (Anthropic only) */
    cacheCreationInputTokens?: number;
    /** Tokens read from the prompt cache (Anthropic only) */
    cacheReadInputTokens?: number;
  };
}

/** Task categories for model routing */
export type TaskCategory = "planning" | "conversation" | "simple" | "research" | "code";
