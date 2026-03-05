import type {
  LlmRegistry,
  LlmTool,
  LlmMessage,
  LlmTextContent,
  LlmToolUseContent,
  LlmToolResultContent,
  TaskCategory,
} from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";

export interface SpecialistContext {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  goalTitle: string;
  previousOutputs?: string[];
  userId?: string;
}

export interface SpecialistResult {
  output: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
}

export abstract class SpecialistAgent {
  protected logger;
  protected registry: LlmRegistry;
  protected db?: Db;

  abstract readonly role: AgentRole;
  abstract readonly taskCategory: TaskCategory;

  constructor(name: string, registry: LlmRegistry, db?: Db) {
    this.registry = registry;
    this.db = db;
    this.logger = createLogger(`specialist-${name}`);
  }

  abstract getSystemPrompt(context: SpecialistContext): string;
  abstract getTools(): LlmTool[];

  async execute(context: SpecialistContext): Promise<SpecialistResult> {
    this.logger.info(
      { taskId: context.taskId, taskTitle: context.taskTitle },
      "specialist execution started",
    );

    const systemPrompt = this.getSystemPrompt(context);
    const tools = this.getTools();

    // Build the user message with context
    let userMessage = `## Task: ${context.taskTitle}\n\n${context.taskDescription}`;

    if (context.previousOutputs?.length) {
      userMessage += "\n\n## Previous Task Outputs\n";
      context.previousOutputs.forEach((output, i) => {
        userMessage += `\n### Step ${i + 1}\n${output}\n`;
      });
    }

    const messages: LlmMessage[] = [{ role: "user", content: userMessage }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let model = "";
    let provider = "";

    // Agentic tool-use loop (max 3 rounds for specialists)
    let response = await this.registry.complete(this.taskCategory, {
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 4096,
    });

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    model = response.model;
    provider = response.provider;

    const MAX_TOOL_ROUNDS = 3;
    let round = 0;

    while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
      round++;
      const toolResults: LlmToolResultContent[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          this.logger.info({ tool: block.name, taskId: context.taskId }, "executing tool");
          const result = await this.executeTool(block as LlmToolUseContent, context);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await this.registry.complete(this.taskCategory, {
        system: systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 4096,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
    }

    // Extract text response
    const textBlocks = response.content
      .filter((b): b is LlmTextContent => b.type === "text")
      .map((b) => b.text);

    const output = textBlocks.join("\n") || "(No output produced)";

    this.logger.info(
      {
        taskId: context.taskId,
        model,
        provider,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        toolRounds: round,
      },
      "specialist execution completed",
    );

    return {
      output,
      model,
      provider,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  protected async executeTool(
    _block: LlmToolUseContent,
    _context: SpecialistContext,
  ): Promise<unknown> {
    return { error: "No tool handler implemented" };
  }
}
