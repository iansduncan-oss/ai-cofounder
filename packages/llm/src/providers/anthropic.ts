import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "../provider.js";
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmContentBlock,
  LlmMessage,
  LlmTool,
  LlmToolResultContent,
} from "../types.js";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  readonly available: boolean;

  private client: Anthropic | null = null;

  constructor(
    private apiKey: string | undefined,
    defaultModel = "claude-sonnet-4-20250514",
  ) {
    this.defaultModel = defaultModel;
    this.available = !!apiKey;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (!this.client) throw new Error("Anthropic provider not configured");

    const model = request.model ?? this.defaultModel;
    const messages = request.messages.map((m) => this.toAnthropicMessage(m));
    const tools = request.tools?.map((t, i, arr) => this.toAnthropicTool(t, i === arr.length - 1));

    // Use structured system content with cache_control for prompt caching.
    // This caches the system prompt across multi-turn tool loops, reducing
    // input token costs by up to 90% on subsequent rounds.
    const system: Anthropic.MessageCreateParams["system"] = request.system
      ? [{ type: "text" as const, text: request.system, cache_control: { type: "ephemeral" as const } }]
      : undefined;

    const response = await this.client.messages.create(
      {
        model,
        max_tokens: request.max_tokens ?? 4096,
        system,
        messages,
        tools,
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
      },
      { signal: AbortSignal.timeout(120_000) },
    );

    const usage = response.usage as Anthropic.Usage & {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };

    return {
      content: response.content.map((block) => this.fromAnthropicBlock(block)),
      model: response.model,
      stop_reason: this.mapStopReason(response.stop_reason),
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens,
      },
    };
  }

  private toAnthropicMessage(msg: LlmMessage): Anthropic.MessageParam {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    const blocks: Array<Anthropic.ContentBlockParam | Anthropic.ToolResultBlockParam> =
      msg.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        if (block.type === "tool_use") {
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        // tool_result
        const tr = block as LlmToolResultContent;
        return {
          type: "tool_result" as const,
          tool_use_id: tr.tool_use_id,
          content: tr.content,
        };
      });

    return { role: msg.role, content: blocks };
  }

  private toAnthropicTool(tool: LlmTool, isLast = false): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: tool.input_schema.properties,
        required: tool.input_schema.required,
      },
      // Cache breakpoint on the last tool — caches the entire system + tools prefix
      ...(isLast ? { cache_control: { type: "ephemeral" as const } } : {}),
    };
  }

  private fromAnthropicBlock(block: Anthropic.ContentBlock): LlmContentBlock {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
    return { type: "text", text: "" };
  }

  private mapStopReason(reason: string | null): LlmCompletionResponse["stop_reason"] {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "tool_use":
        return "tool_use";
      case "max_tokens":
        return "max_tokens";
      default:
        return "unknown";
    }
  }
}
