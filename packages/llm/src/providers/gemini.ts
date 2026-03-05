import { randomUUID } from "node:crypto";
import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Part,
  SchemaType,
} from "@google/generative-ai";
import type { LlmProvider } from "../provider.js";
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmContentBlock,
  LlmTool,
  LlmToolParameter,
} from "../types.js";

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly defaultModel: string;
  readonly available: boolean;

  private client: GoogleGenerativeAI | null = null;

  constructor(apiKey: string | undefined, defaultModel = "gemini-2.5-flash") {
    this.defaultModel = defaultModel;
    this.available = !!apiKey;
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
    }
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (!this.client) throw new Error("Gemini provider not configured");

    const model = request.model ?? this.defaultModel;
    const genModel = this.client.getGenerativeModel({
      model,
      ...(request.system ? { systemInstruction: request.system } : {}),
    });

    const contents = this.buildContents(request.messages);
    const tools = request.tools?.length
      ? [{ functionDeclarations: request.tools.map((t) => this.toGeminiTool(t)) }]
      : undefined;

    const result = await genModel.generateContent({
      contents,
      ...(tools ? { tools } : {}),
      generationConfig: {
        maxOutputTokens: request.max_tokens ?? 4096,
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
      },
    });

    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) throw new Error("Gemini: empty response");

    const blocks = this.extractContent(candidate.content.parts);
    const hasToolUse = blocks.some((b) => b.type === "tool_use");

    return {
      content: blocks,
      model,
      stop_reason: hasToolUse ? "tool_use" : "end_turn",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  private buildContents(messages: LlmCompletionRequest["messages"]): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        });
        continue;
      }

      const parts: Part[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            functionCall: { name: block.name, args: block.input },
          });
        } else if (block.type === "tool_result") {
          parts.push({
            functionResponse: {
              name: block.tool_use_id,
              response: { result: block.content },
            },
          });
        }
      }

      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts,
      });
    }

    return contents;
  }

  private toGeminiTool(tool: LlmTool): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: this.convertProperties(tool.input_schema.properties),
        required: tool.input_schema.required,
      } as FunctionDeclarationSchema,
    };
  }

  private convertProperties(props: Record<string, LlmToolParameter>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      result[key] = this.convertParam(val);
    }
    return result;
  }

  private convertParam(param: LlmToolParameter): unknown {
    const base: Record<string, unknown> = {
      type: this.mapType(param.type),
      description: param.description,
    };
    if (param.enum) base.enum = param.enum;
    if (param.items) base.items = this.convertParam(param.items);
    if (param.properties) {
      base.properties = this.convertProperties(param.properties);
      if (param.required) base.required = param.required;
    }
    return base;
  }

  private mapType(type: string): SchemaType {
    switch (type) {
      case "string":
        return SchemaType.STRING;
      case "number":
        return SchemaType.NUMBER;
      case "integer":
        return SchemaType.INTEGER;
      case "boolean":
        return SchemaType.BOOLEAN;
      case "array":
        return SchemaType.ARRAY;
      case "object":
        return SchemaType.OBJECT;
      default:
        return SchemaType.STRING;
    }
  }

  private extractContent(parts: Part[]): LlmContentBlock[] {
    const blocks: LlmContentBlock[] = [];

    for (const part of parts) {
      if ("text" in part && part.text) {
        blocks.push({ type: "text", text: part.text });
      }
      if ("functionCall" in part && part.functionCall) {
        blocks.push({
          type: "tool_use",
          id: `gemini-${randomUUID()}`,
          name: part.functionCall.name,
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    return blocks;
  }
}
