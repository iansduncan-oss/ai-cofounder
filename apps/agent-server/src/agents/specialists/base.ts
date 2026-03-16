import type {
  LlmRegistry,
  LlmTool,
  LlmMessage,
  LlmTextContent,
  LlmToolUseContent,
  LlmToolResultContent,
  TaskCategory,
  EmbeddingService,
} from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { trace, SpanStatusCode } from "@opentelemetry/api";

export interface SpecialistContext {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  goalTitle: string;
  previousOutputs?: string[];
  userId?: string;
  goalId?: string;
  messagingService?: unknown; // AgentMessagingService — kept as unknown to avoid circular dep
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
  protected embeddingService?: EmbeddingService;

  abstract readonly role: AgentRole;
  abstract readonly taskCategory: TaskCategory;

  constructor(name: string, registry: LlmRegistry, db?: Db, embeddingService?: EmbeddingService) {
    this.registry = registry;
    this.db = db;
    this.embeddingService = embeddingService;
    this.logger = createLogger(`specialist-${name}`);
  }

  abstract getSystemPrompt(context: SpecialistContext): string;
  abstract getTools(): LlmTool[];

  async execute(context: SpecialistContext): Promise<SpecialistResult> {
    const tracer = trace.getTracer("ai-cofounder");
    return tracer.startActiveSpan(`specialist.${this.role}`, async (span) => {
      span.setAttribute("agent.role", this.role);
      span.setAttribute("task.id", context.taskId);
      span.setAttribute("task.title", context.taskTitle);

      try {
        return await this._executeInner(context);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private async _executeInner(context: SpecialistContext): Promise<SpecialistResult> {
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
    let response = await this.completeWithRetry(this.taskCategory, {
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

      response = await this.completeWithRetry(this.taskCategory, {
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

  /** Call registry.complete with a single retry on transient failures. */
  protected async completeWithRetry(
    ...args: Parameters<LlmRegistry["complete"]>
  ): ReturnType<LlmRegistry["complete"]> {
    const tracer = trace.getTracer("ai-cofounder");
    return tracer.startActiveSpan(`llm.complete.${args[0]}`, async (span) => {
      span.setAttribute("llm.task_category", args[0]);
      try {
        const result = await this._completeWithRetryInner(...args);
        span.setAttribute("llm.model", result.model);
        span.setAttribute("llm.provider", result.provider);
        span.setAttribute("llm.input_tokens", result.usage.inputTokens);
        span.setAttribute("llm.output_tokens", result.usage.outputTokens);
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private async _completeWithRetryInner(
    ...args: Parameters<LlmRegistry["complete"]>
  ): ReturnType<LlmRegistry["complete"]> {
    const MAX_RETRIES = 1;
    const BASE_DELAY_MS = 1000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.registry.complete(...args);
      } catch (err) {
        const isTransient =
          err instanceof Error &&
          (/rate.?limit|429|timeout|econnreset|socket hang up|503|overloaded/i.test(err.message));

        if (!isTransient || attempt === MAX_RETRIES) throw err;

        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        this.logger.warn({ err, attempt: attempt + 1, delayMs: Math.round(delayMs) }, "transient LLM failure, retrying");
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error("retry loop exited unexpectedly");
  }

  protected async executeTool(
    _block: LlmToolUseContent,
    _context: SpecialistContext,
  ): Promise<unknown> {
    return { error: "No tool handler implemented" };
  }
}
