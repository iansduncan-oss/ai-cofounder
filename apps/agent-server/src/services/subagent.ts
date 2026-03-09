// SubagentRunner — autonomous Claude-powered subagent with extended tool loop.
// Spawned by the orchestrator via BullMQ, runs up to 25 tool rounds independently.

import type {
  LlmRegistry,
  LlmMessage,
  LlmToolResultContent,
  LlmTextContent,
  EmbeddingService,
} from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import {
  recallMemories,
  searchMemoriesByVector,
  updateSubagentRunStatus,
} from "@ai-cofounder/db";
import type { RedisPubSub, SubagentProgressEvent } from "@ai-cofounder/queue";
import { buildSharedToolList, executeSharedTool } from "../agents/tool-executor.js";
import { recordToolMetrics, recordSubagentMetrics } from "../plugins/observability.js";
import { recordToolExecution } from "@ai-cofounder/db";
import type { N8nService } from "./n8n.js";
import type { WorkspaceService } from "./workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";

const logger = createLogger("subagent-runner");

const MAX_TOOL_ROUNDS = 25;

// Tools that subagents do NOT get (prevents recursion, keeps orchestrator authority)
const EXCLUDED_TOOLS = new Set([
  "delegate_to_subagent",
  "delegate_parallel",
  "check_subagent",
  "create_plan",
  "create_milestone",
  "request_approval",
]);

export interface SubagentRunParams {
  subagentRunId: string;
  title: string;
  instruction: string;
  conversationId?: string;
  goalId?: string;
  userId?: string;
  parentRequestId?: string;
}

export interface SubagentResult {
  output: string;
  model: string;
  provider?: string;
  usage: { inputTokens: number; outputTokens: number };
  toolsUsed: string[];
  rounds: number;
  durationMs: number;
}

export class SubagentRunner {
  private registry: LlmRegistry;
  private db: Db;
  private embeddingService?: EmbeddingService;
  private n8nService?: N8nService;
  private sandboxService?: SandboxService;
  private workspaceService?: WorkspaceService;
  private redisPubSub?: RedisPubSub;

  constructor(
    registry: LlmRegistry,
    db: Db,
    embeddingService?: EmbeddingService,
    n8nService?: N8nService,
    sandboxService?: SandboxService,
    workspaceService?: WorkspaceService,
    redisPubSub?: RedisPubSub,
  ) {
    this.registry = registry;
    this.db = db;
    this.embeddingService = embeddingService;
    this.n8nService = n8nService;
    this.sandboxService = sandboxService;
    this.workspaceService = workspaceService;
    this.redisPubSub = redisPubSub;
  }

  async run(params: SubagentRunParams): Promise<SubagentResult> {
    const startTime = Date.now();
    const toolsUsedSet = new Set<string>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let providerName: string | undefined;
    let modelName = "";

    // Mark as running
    await updateSubagentRunStatus(this.db, params.subagentRunId, { status: "running" });
    await this.publishProgress(params.subagentRunId, {
      subagentRunId: params.subagentRunId,
      type: "subagent_started",
      timestamp: Date.now(),
    });

    try {
      // Load memory context
      const memoryContext = await this.loadMemoryContext(params.instruction, params.userId);

      // Build system prompt
      const systemPrompt = this.buildSubagentSystemPrompt(params.title, memoryContext);

      // Build tools (excluding delegation tools)
      const tools = buildSharedToolList(
        {
          db: this.db,
          embeddingService: this.embeddingService,
          n8nService: this.n8nService,
          sandboxService: this.sandboxService,
          workspaceService: this.workspaceService,
        },
        EXCLUDED_TOOLS,
      );

      const messages: LlmMessage[] = [
        { role: "user", content: params.instruction },
      ];

      // Initial LLM call
      let response = await this.registry.complete("code", {
        system: systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 4096,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      providerName = response.provider;
      modelName = response.model;

      // Agentic tool loop
      let round = 0;
      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            toolsUsedSet.add(block.name);

            await this.publishProgress(params.subagentRunId, {
              subagentRunId: params.subagentRunId,
              type: "subagent_tool_call",
              round,
              toolName: block.name,
              timestamp: Date.now(),
            });

            const toolStart = Date.now();
            let success = true;
            let result: unknown;

            try {
              result = await executeSharedTool(block, {
                db: this.db,
                embeddingService: this.embeddingService,
                n8nService: this.n8nService,
                sandboxService: this.sandboxService,
                workspaceService: this.workspaceService,
              }, {
                conversationId: params.conversationId ?? params.subagentRunId,
                userId: params.userId,
              });

              // null means unknown tool
              if (result === null) {
                result = { error: `Unknown tool: ${block.name}` };
                success = false;
              } else if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
                success = false;
              }
            } catch (err) {
              success = false;
              result = { error: err instanceof Error ? err.message : String(err) };
            }

            const toolDuration = Date.now() - toolStart;
            recordToolMetrics({ toolName: block.name, durationMs: toolDuration, success });
            recordToolExecution(this.db, {
              toolName: block.name,
              durationMs: toolDuration,
              success,
              errorMessage: success ? undefined : "tool returned error",
              requestId: params.parentRequestId,
            }).catch(() => {});

            await this.publishProgress(params.subagentRunId, {
              subagentRunId: params.subagentRunId,
              type: "subagent_tool_result",
              round,
              toolName: block.name,
              timestamp: Date.now(),
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        response = await this.registry.complete("code", {
          system: systemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          max_tokens: 4096,
        });

        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Extract final text
      const textBlocks = response.content
        .filter((b): b is LlmTextContent => b.type === "text")
        .map((b) => b.text);
      const output = textBlocks.join("\n") || "(Subagent completed with no text output)";
      const durationMs = Date.now() - startTime;
      const toolsUsed = Array.from(toolsUsedSet);

      // Update DB record
      await updateSubagentRunStatus(this.db, params.subagentRunId, {
        status: "completed",
        output,
        toolRounds: round,
        toolsUsed,
        tokens: totalInputTokens + totalOutputTokens,
        model: modelName,
        provider: providerName,
        durationMs,
      });

      await this.publishProgress(params.subagentRunId, {
        subagentRunId: params.subagentRunId,
        type: "subagent_completed",
        output: output.slice(0, 500),
        timestamp: Date.now(),
      });

      recordSubagentMetrics({ status: "completed", durationMs, rounds: round });

      logger.info(
        { subagentRunId: params.subagentRunId, rounds: round, toolsUsed, durationMs },
        "subagent run completed",
      );

      return { output, model: modelName, provider: providerName, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, toolsUsed, rounds: round, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await updateSubagentRunStatus(this.db, params.subagentRunId, {
        status: "failed",
        error: errorMsg,
        tokens: totalInputTokens + totalOutputTokens,
        model: modelName,
        provider: providerName,
        durationMs,
      });

      await this.publishProgress(params.subagentRunId, {
        subagentRunId: params.subagentRunId,
        type: "subagent_failed",
        error: errorMsg,
        timestamp: Date.now(),
      });

      recordSubagentMetrics({ status: "failed", durationMs, rounds: 0 });

      logger.error({ subagentRunId: params.subagentRunId, err }, "subagent run failed");
      throw err;
    }
  }

  private async loadMemoryContext(query: string, userId?: string): Promise<string> {
    if (!userId) return "";
    try {
      const userMemories = await recallMemories(this.db, userId, { limit: 10 });
      let relevantMemories: Array<{ id: string; category: string; key: string; content: string }> = [];

      if (this.embeddingService) {
        try {
          const queryEmbedding = await this.embeddingService.embed(query);
          const vectorResults = await searchMemoriesByVector(this.db, queryEmbedding, userId, 5);
          relevantMemories = vectorResults.map((m) => ({ id: m.id, category: m.category, key: m.key, content: m.content }));
        } catch { /* non-fatal */ }
      }

      const seenIds = new Set(relevantMemories.map((m) => m.id));
      const generalMemories = userMemories.filter((m) => !seenIds.has(m.id));
      const parts: string[] = [];

      if (relevantMemories.length > 0) {
        parts.push("Relevant context:");
        parts.push(...relevantMemories.map((m) => `- [${m.category}] ${m.key}: ${m.content}`));
      }
      if (generalMemories.length > 0) {
        if (parts.length > 0) parts.push("");
        parts.push("General knowledge:");
        parts.push(...generalMemories.map((m) => `- [${m.category}] ${m.key}: ${m.content}`));
      }

      return parts.join("\n");
    } catch {
      return "";
    }
  }

  private buildSubagentSystemPrompt(title: string, memoryContext: string): string {
    return `You are an autonomous AI subagent working on a specific task: "${title}"

You have full access to tools for file operations, code execution, git, web search, and memory. Work independently to complete your assigned task thoroughly.

## Guidelines
- Be thorough and self-verifying. After making changes, read them back to confirm correctness.
- If you encounter errors, debug and fix them — don't give up after one attempt.
- Write clean, production-quality output.
- When done, provide a clear summary of what you accomplished.
- You have up to ${MAX_TOOL_ROUNDS} tool rounds — use them wisely but don't rush.

## Constraints
- You cannot delegate to other subagents or create plans/milestones.
- You cannot request human approval — work within your authority.
- Focus solely on your assigned task.${memoryContext ? `\n\n## Context\n${memoryContext}` : ""}`;
  }

  private async publishProgress(subagentRunId: string, event: SubagentProgressEvent): Promise<void> {
    if (!this.redisPubSub) return;
    try {
      await this.redisPubSub.publishSubagent(subagentRunId, event);
    } catch (err) {
      logger.warn({ err, subagentRunId }, "failed to publish subagent progress (non-fatal)");
    }
  }
}
