import OpenAI from "openai";
import type { LlmProvider } from "../provider.js";
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmContentBlock,
  LlmTool,
} from "../types.js";

/**
 * Base class for OpenAI-compatible APIs (Groq, OpenRouter, etc.).
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly available: boolean;

  protected client: OpenAI | null = null;

  constructor(name: string, apiKey: string | undefined, defaultModel: string, baseURL: string) {
    this.name = name;
    this.defaultModel = defaultModel;
    this.available = !!apiKey;
    if (apiKey) {
      this.client = new OpenAI({ apiKey, baseURL });
    }
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (!this.client) throw new Error(`${this.name} provider not configured`);

    const model = request.model ?? this.defaultModel;
    const messages = this.buildMessages(request);
    const tools = request.tools?.length
      ? request.tools.map((t) => this.toOpenAITool(t))
      : undefined;

    const response = await this.client.chat.completions.create({
      model,
      messages,
      tools,
      max_tokens: request.max_tokens ?? 4096,
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
    });

    const choice = response.choices[0];
    if (!choice) throw new Error(`${this.name}: empty response`);

    return {
      content: this.extractContent(choice),
      model: response.model,
      stop_reason: this.mapFinishReason(choice.finish_reason),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  private buildMessages(request: LlmCompletionRequest): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }

    for (const msg of request.messages) {
      if (typeof msg.content === "string") {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
        continue;
      }

      // Handle structured content blocks
      if (msg.role === "user") {
        // Check for tool_result blocks (sent as "tool" role in OpenAI)
        const toolResults = msg.content.filter((b) => b.type === "tool_result");
        const otherBlocks = msg.content.filter((b) => b.type !== "tool_result");

        for (const tr of toolResults) {
          if (tr.type === "tool_result") {
            messages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            });
          }
        }

        if (otherBlocks.length > 0) {
          const text = otherBlocks
            .filter((b) => b.type === "text")
            .map((b) => (b as { type: "text"; text: string }).text)
            .join("\n");
          if (text) {
            messages.push({ role: "user", content: text });
          }
        }
      } else {
        // Assistant message with tool_use blocks
        const textParts = msg.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join("\n");

        const toolCalls = msg.content
          .filter((b) => b.type === "tool_use")
          .map((b) => {
            if (b.type !== "tool_use") throw new Error("unreachable");
            return {
              id: b.id,
              type: "function" as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input),
              },
            };
          });

        messages.push({
          role: "assistant",
          content: textParts || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
    }

    return messages;
  }

  private toOpenAITool(tool: LlmTool): OpenAI.ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.input_schema.properties,
          required: tool.input_schema.required,
        },
      },
    };
  }

  private extractContent(choice: OpenAI.ChatCompletion.Choice): LlmContentBlock[] {
    const blocks: LlmContentBlock[] = [];

    if (choice.message.content) {
      blocks.push({ type: "text", text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
    }

    return blocks;
  }

  private mapFinishReason(reason: string | null): LlmCompletionResponse["stop_reason"] {
    switch (reason) {
      case "stop":
        return "end_turn";
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      default:
        return "unknown";
    }
  }
}
