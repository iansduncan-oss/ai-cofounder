import type {
  LlmRegistry,
  LlmTool,
  LlmMessage,
  LlmToolUseContent,
  LlmToolResultContent,
  LlmTextContent,
  TaskCategory,
  EmbeddingService,
} from "@ai-cofounder/llm";
import { createLogger, sanitizeToolResult } from "@ai-cofounder/shared";
import type { AgentRole, AgentMessage } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  createApproval,
  createMilestone,
  recordToolExecution,
  recordLlmUsage,
} from "@ai-cofounder/db";
import { buildSystemPrompt, sanitizeForPrompt } from "./prompts/system.js";
import { recordToolMetrics } from "../plugins/observability.js";
import { recordActionSafe } from "../services/action-recorder.js";
import type { StreamCallback } from "./stream-events.js";
import type { N8nService } from "../services/n8n.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { notifyApprovalCreated } from "../services/notifications.js";
import {
  buildSharedToolList,
  executeWithTierCheck,
  type ToolExecutorContext,
} from "./tool-executor.js";
import type { AgentMessagingService } from "../services/agent-messaging.js";
import type { AutonomyTierService } from "../services/autonomy-tier.js";
import type { ProjectRegistryService } from "../services/project-registry.js";
import type { MonitoringService } from "../services/monitoring.js";
import type { BrowserService } from "../services/browser.js";
import type { GmailService } from "../services/gmail.js";
import type { CalendarService } from "../services/calendar.js";
import type { EpisodicMemoryService } from "../services/episodic-memory.js";
import type { ProceduralMemoryService } from "../services/procedural-memory.js";
import type { PrReviewService } from "../services/pr-review.js";
import type { OutboundWebhookService } from "../services/outbound-webhooks.js";
import type { ConversationBranchingService } from "../services/conversation-branching.js";
import type { DiscordService } from "../services/discord.js";
import type { VpsCommandService } from "../services/vps-command.js";
import type { FailurePatternService } from "../services/failure-patterns.js";
import { ToolCache } from "../services/tool-cache.js";
import { ComplexityEstimator } from "../services/complexity-estimator.js";
import {
  DELEGATE_TO_SUBAGENT_TOOL,
  DELEGATE_PARALLEL_TOOL,
  CHECK_SUBAGENT_TOOL,
} from "./tools/subagent-tools.js";
import { createSubagentRun, getSubagentRun } from "@ai-cofounder/db";
import { enqueueSubagentTask } from "@ai-cofounder/queue";

import {
  CREATE_PLAN_TOOL,
  CREATE_MILESTONE_TOOL,
  REQUEST_APPROVAL_TOOL,
  DESTRUCTIVE_TOOLS,
  type CreatePlanInput,
} from "./orchestrator/tool-definitions.js";
import { persistPlan, buildPlanSummary, type PlanResult } from "./orchestrator/plan-persister.js";
import {
  completeWithRetry,
  extractAndStoreThinking,
  filterAvailableTools,
  sanitizeToolInput,
  summarizeToolResult,
  checkOrCreateDestructiveApproval,
  trimHistory,
} from "./orchestrator/helpers.js";
import {
  buildMemoryContext,
  resolveActiveProjectSlug,
  retrieveRagContext,
  appendEfficacyAndFailureHints,
} from "./orchestrator/context-builder.js";

// Re-export types and helpers used by external callers and tests
export { validateDependencyGraph } from "./orchestrator/dependency-graph.js";
export type { PlanResult } from "./orchestrator/plan-persister.js";

/* ── Result types ── */

export interface OrchestratorResult {
  conversationId: string;
  agentRole: AgentRole;
  response: string;
  model: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number };
  plan?: PlanResult;
  suggestions?: string[];
}

/* ── Orchestrator options ── */

export interface OrchestratorOptions {
  registry: LlmRegistry;
  db?: Db;
  taskCategory?: TaskCategory;
  embeddingService?: EmbeddingService;
  n8nService?: N8nService;
  sandboxService?: SandboxService;
  workspaceService?: WorkspaceService;
  messagingService?: AgentMessagingService;
  autonomyTierService?: AutonomyTierService;
  projectRegistryService?: ProjectRegistryService;
  monitoringService?: MonitoringService;
  browserService?: BrowserService;
  gmailService?: GmailService;
  calendarService?: CalendarService;
  episodicMemoryService?: EpisodicMemoryService;
  proceduralMemoryService?: ProceduralMemoryService;
  prReviewService?: PrReviewService;
  outboundWebhookService?: OutboundWebhookService;
  conversationBranchingService?: ConversationBranchingService;
  discordService?: DiscordService;
  vpsCommandService?: VpsCommandService;
  failurePatternsService?: FailurePatternService;
  isAutonomous?: boolean;
  workspaceId?: string;
}

/* ── Orchestrator class ── */

export class Orchestrator {
  private logger = createLogger("orchestrator");
  private db?: Db;
  private registry: LlmRegistry;
  private taskCategory: TaskCategory;
  private embeddingService?: EmbeddingService;
  private n8nService?: N8nService;
  private sandboxService?: SandboxService;
  private workspaceService?: WorkspaceService;
  private messagingService?: AgentMessagingService;
  private autonomyTierService?: AutonomyTierService;
  private projectRegistryService?: ProjectRegistryService;
  private monitoringService?: MonitoringService;
  private browserService?: BrowserService;
  private gmailService?: GmailService;
  private calendarService?: CalendarService;
  private episodicMemoryService?: EpisodicMemoryService;
  private proceduralMemoryService?: ProceduralMemoryService;
  private prReviewService?: PrReviewService;
  private outboundWebhookService?: OutboundWebhookService;
  private conversationBranchingService?: ConversationBranchingService;
  private discordService?: DiscordService;
  private vpsCommandService?: VpsCommandService;
  private failurePatternsService?: FailurePatternService;
  private isAutonomous: boolean;
  private workspaceId?: string;
  private requestId?: string;

  constructor(options: OrchestratorOptions) {
    this.registry = options.registry;
    this.db = options.db;
    this.taskCategory = options.taskCategory ?? "conversation";
    this.embeddingService = options.embeddingService;
    this.n8nService = options.n8nService;
    this.sandboxService = options.sandboxService;
    this.workspaceService = options.workspaceService;
    this.messagingService = options.messagingService;
    this.autonomyTierService = options.autonomyTierService;
    this.projectRegistryService = options.projectRegistryService;
    this.monitoringService = options.monitoringService;
    this.browserService = options.browserService;
    this.gmailService = options.gmailService;
    this.calendarService = options.calendarService;
    this.episodicMemoryService = options.episodicMemoryService;
    this.proceduralMemoryService = options.proceduralMemoryService;
    this.prReviewService = options.prReviewService;
    this.outboundWebhookService = options.outboundWebhookService;
    this.conversationBranchingService = options.conversationBranchingService;
    this.discordService = options.discordService;
    this.vpsCommandService = options.vpsCommandService;
    this.failurePatternsService = options.failurePatternsService;
    this.isAutonomous = options.isAutonomous ?? false;
    this.workspaceId = options.workspaceId;
  }

  /** Set workspace context for the next run (allows reusing singleton orchestrator). */
  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  private buildSharedToolListForRun(includeReviewer: boolean): LlmTool[] {
    return buildSharedToolList(
      {
        db: this.db,
        embeddingService: this.embeddingService,
        n8nService: this.n8nService,
        sandboxService: this.sandboxService,
        workspaceService: this.workspaceService,
        messagingService: this.messagingService,
        projectRegistryService: this.projectRegistryService,
        monitoringService: this.monitoringService,
        browserService: this.browserService,
        gmailService: this.gmailService,
        calendarService: this.calendarService,
        episodicMemoryService: this.episodicMemoryService,
        proceduralMemoryService: this.proceduralMemoryService,
        ...(includeReviewer ? { prReviewService: this.prReviewService } : {}),
      },
      undefined,
      this.autonomyTierService,
    );
  }

  private async loadContext(
    message: string,
    conversationId: string | undefined,
    userId: string | undefined,
    fullContext: boolean,
  ): Promise<string> {
    let memoryContext = await buildMemoryContext({
      db: this.db,
      userId,
      message,
      embeddingService: this.embeddingService,
      episodicMemoryService: fullContext ? this.episodicMemoryService : undefined,
      proceduralMemoryService: fullContext ? this.proceduralMemoryService : undefined,
      fullContext,
    });

    const activeProjectSlug = await resolveActiveProjectSlug(
      this.db,
      conversationId,
      this.projectRegistryService,
    );

    const ragContext = await retrieveRagContext(
      this.db,
      this.embeddingService,
      this.registry,
      message,
      activeProjectSlug,
    );
    if (ragContext) {
      const wrappedRag = `<user-data>\n${sanitizeForPrompt(ragContext)}\n</user-data>`;
      memoryContext = memoryContext ? `${memoryContext}\n\n${wrappedRag}` : wrappedRag;
    }

    memoryContext = await appendEfficacyAndFailureHints(
      memoryContext,
      this.db,
      fullContext ? this.failurePatternsService : undefined,
    );

    return memoryContext;
  }

  async run(
    message: string,
    conversationId?: string,
    history?: AgentMessage[],
    userId?: string,
    requestId?: string,
  ): Promise<OrchestratorResult> {
    this.requestId = requestId;
    const id = conversationId ?? crypto.randomUUID();
    this.logger.info({ conversationId: id }, "orchestrator run started");

    const memoryContext = await this.loadContext(message, conversationId, userId, true);
    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);

    // Build message history for context
    const messages: LlmMessage[] = [];
    const trimmed = history?.length ? trimHistory(history) : [];
    if (trimmed.length) {
      for (const msg of trimmed) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }
    messages.push({ role: "user", content: message });

    // Build tools array: orchestrator-only tools + shared tools
    const rawTools: LlmTool[] = this.db
      ? [
          CREATE_PLAN_TOOL,
          CREATE_MILESTONE_TOOL,
          REQUEST_APPROVAL_TOOL,
          DELEGATE_TO_SUBAGENT_TOOL,
          DELEGATE_PARALLEL_TOOL,
          CHECK_SUBAGENT_TOOL,
        ]
      : [];

    rawTools.push(...this.buildSharedToolListForRun(true));

    const tools = await filterAvailableTools(rawTools);
    const toolCache = new ToolCache();

    try {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let plan: PlanResult | undefined;

      // Estimate task complexity for dynamic budgets
      const estimator = new ComplexityEstimator();
      const complexity = estimator.estimate({
        description: message,
        toolCount: tools.length,
        goalPriority: this.isAutonomous ? "high" : "medium",
      });
      this.logger.info(
        {
          complexity: complexity.level,
          score: complexity.score,
          roundBudget: complexity.roundBudget,
          thinkingBudget: complexity.thinkingTokenBudget,
        },
        "task complexity estimated",
      );

      // Agentic tool-use loop with dynamic budgets
      const useThinking = complexity.thinkingTokenBudget > 0;
      let response = await completeWithRetry(this.registry, this.taskCategory, {
        system: systemPrompt,
        messages,
        tools,
        max_tokens: useThinking ? complexity.thinkingTokenBudget + 8192 : 8192,
        ...(useThinking
          ? {
              thinking: { type: "enabled" as const, budget_tokens: complexity.thinkingTokenBudget },
            }
          : {}),
        metadata: { agentRole: "orchestrator", conversationId: id, userId },
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      const providerName = response.provider;

      const MAX_TOOL_ROUNDS = complexity.roundBudget;
      let round = 0;

      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            this.logger.info({ tool: block.name, conversationId: id }, "executing tool");

            // Destructive tools require an approved approval before execution
            if (DESTRUCTIVE_TOOLS.has(block.name)) {
              const approvalResult = await checkOrCreateDestructiveApproval(
                this.db,
                block.name,
                id,
              );
              if (!approvalResult.approved) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: sanitizeToolResult(JSON.stringify(approvalResult)),
                });
                continue;
              }
            }

            // Check tool cache before executing
            const cached = toolCache.get(block.name, block.input as Record<string, unknown>);
            let result: unknown;
            if (cached !== undefined) {
              result = cached;
            } else {
              result = await this.executeTool(block, id, userId);
              toolCache.set(block.name, block.input as Record<string, unknown>, result);
            }

            // If create_plan returned a plan, capture it
            if (block.name === "create_plan" && result && "goalId" in (result as object)) {
              plan = result as PlanResult;
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: sanitizeToolResult(JSON.stringify(result)),
            });
          }
        }

        // Continue the conversation with tool results
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        response = await completeWithRetry(this.registry, this.taskCategory, {
          system: systemPrompt,
          messages,
          tools,
          max_tokens: 4096,
          metadata: { agentRole: "orchestrator", conversationId: id, userId },
        });

        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Extract thinking traces and filter to non-thinking content
      const finalContent = extractAndStoreThinking(response.content, {
        db: this.db,
        conversationId: id,
        round,
        requestId: this.requestId,
      });

      // Extract final text response
      const textBlocks = finalContent
        .filter((block): block is LlmTextContent => block.type === "text")
        .map((block) => block.text);

      let responseText = textBlocks.join("\n");

      if (!responseText && plan) {
        responseText = buildPlanSummary(plan);
      }

      this.logger.info(
        {
          conversationId: id,
          model: response.model,
          provider: providerName,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          toolRounds: round,
          hasPlan: !!plan,
        },
        "orchestrator run completed",
      );

      // Record LLM usage for the orchestrator's own calls
      if (this.db) {
        try {
          await recordLlmUsage(this.db, {
            provider: providerName,
            model: response.model,
            taskCategory: this.taskCategory,
            agentRole: "orchestrator",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            conversationId: id,
            workspaceId: this.workspaceId ?? "",
          });
        } catch (usageErr) {
          this.logger.warn({ err: usageErr }, "failed to record orchestrator LLM usage");
        }
      }

      return {
        conversationId: id,
        agentRole: "orchestrator",
        response: responseText,
        model: response.model,
        provider: providerName,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        },
        plan,
      };
    } catch (err) {
      this.logger.error({ conversationId: id, err }, "orchestrator run failed");
      throw err;
    }
  }

  async runStream(
    message: string,
    onEvent: StreamCallback,
    conversationId?: string,
    history?: AgentMessage[],
    userId?: string,
    requestId?: string,
    signal?: AbortSignal,
  ): Promise<OrchestratorResult> {
    this.requestId = requestId;
    const id = conversationId ?? crypto.randomUUID();

    await onEvent({ type: "thinking", data: { round: 0, message: "Loading context..." } });

    // Streaming path uses the lighter context (no episodic/procedural priming, no decision surfacing)
    const memoryContext = await this.loadContext(message, conversationId, userId, false);
    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);

    const messages: LlmMessage[] = [];
    const trimmed = history?.length ? trimHistory(history) : [];
    for (const msg of trimmed) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }
    messages.push({ role: "user", content: message });

    const rawToolsStream: LlmTool[] = this.db
      ? [
          CREATE_PLAN_TOOL,
          CREATE_MILESTONE_TOOL,
          REQUEST_APPROVAL_TOOL,
          DELEGATE_TO_SUBAGENT_TOOL,
          DELEGATE_PARALLEL_TOOL,
          CHECK_SUBAGENT_TOOL,
        ]
      : [];
    rawToolsStream.push(...this.buildSharedToolListForRun(false));

    const tools = await filterAvailableTools(rawToolsStream);
    const toolCache = new ToolCache();

    try {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let plan: PlanResult | undefined;

      await onEvent({ type: "thinking", data: { round: 1, message: "Generating response..." } });

      // Track whether the provider streamed text deltas directly (e.g. Anthropic)
      let streamedDirectly = false;
      const streamTextDelta = (text: string) => {
        streamedDirectly = true;
        onEvent({ type: "text_delta", data: { text } });
      };

      if (signal?.aborted) throw new Error("Request aborted");
      let response = await completeWithRetry(this.registry, this.taskCategory, {
        system: systemPrompt,
        messages,
        tools,
        max_tokens: 4096,
        metadata: { agentRole: "orchestrator", conversationId: id },
        onTextDelta: streamTextDelta,
      });
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      const providerName = response.provider;

      const MAX_TOOL_ROUNDS = 10;
      let round = 0;

      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        streamedDirectly = false; // reset for each round
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            const toolInput = block.input as Record<string, unknown>;
            await onEvent({
              type: "tool_call",
              data: { tool: block.name, input: sanitizeToolInput(toolInput) },
            });

            // Destructive tools require an approved approval before execution
            if (DESTRUCTIVE_TOOLS.has(block.name)) {
              const approvalResult = await checkOrCreateDestructiveApproval(
                this.db,
                block.name,
                id,
              );
              if (!approvalResult.approved) {
                await onEvent({
                  type: "tool_result",
                  data: {
                    tool: block.name,
                    summary: `Blocked: ${block.name} requires approval`,
                    needs_confirmation: true,
                  },
                });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: sanitizeToolResult(JSON.stringify(approvalResult)),
                });
                continue;
              }
            }

            // Check tool cache before executing
            const cached = toolCache.get(block.name, toolInput);
            let result: unknown;
            if (cached !== undefined) {
              result = cached;
            } else {
              result = await this.executeTool(block, id, userId);
              toolCache.set(block.name, toolInput, result);
            }

            if (block.name === "create_plan" && result && "goalId" in (result as object)) {
              plan = result as PlanResult;
            }

            await onEvent({
              type: "tool_result",
              data: { tool: block.name, summary: summarizeToolResult(block.name, result) },
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: sanitizeToolResult(JSON.stringify(result)),
            });
          }
        }

        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        await onEvent({
          type: "thinking",
          data: { round: round + 1, message: `Processing (round ${round + 1})...` },
        });
        if (signal?.aborted) throw new Error("Request aborted");
        response = await completeWithRetry(this.registry, this.taskCategory, {
          system: systemPrompt,
          messages,
          tools,
          max_tokens: 4096,
          metadata: { agentRole: "orchestrator", conversationId: id },
          onTextDelta: streamTextDelta,
        });
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Extract thinking traces and filter to non-thinking content
      const finalContent = extractAndStoreThinking(response.content, {
        db: this.db,
        conversationId: id,
        round,
        requestId: this.requestId,
      });
      const textBlocks = finalContent
        .filter((b): b is LlmTextContent => b.type === "text")
        .map((b) => b.text);
      let responseText = textBlocks.join("\n");

      if (!responseText && plan) responseText = buildPlanSummary(plan);

      // If the provider didn't stream text deltas directly, emit chunks for progressive rendering
      if (!streamedDirectly) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < responseText.length; i += CHUNK_SIZE) {
          await onEvent({
            type: "text_delta",
            data: { text: responseText.slice(i, i + CHUNK_SIZE) },
          });
        }
      }
      await onEvent({
        type: "done",
        data: {
          response: responseText,
          model: response.model,
          provider: providerName,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        },
      });

      // Record LLM usage for the orchestrator's streaming calls
      if (this.db) {
        try {
          await recordLlmUsage(this.db, {
            provider: providerName,
            model: response.model,
            taskCategory: this.taskCategory,
            agentRole: "orchestrator",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            conversationId: id,
            workspaceId: this.workspaceId ?? "",
          });
        } catch (usageErr) {
          this.logger.warn({ err: usageErr }, "failed to record orchestrator LLM usage");
        }
      }

      return {
        conversationId: id,
        agentRole: "orchestrator",
        response: responseText,
        model: response.model,
        provider: providerName,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        plan,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await onEvent({ type: "error", data: { error: errorMsg } });
      throw err;
    }
  }

  private async executeTool(
    block: LlmToolUseContent,
    conversationId: string,
    userId?: string,
  ): Promise<unknown> {
    const startTime = Date.now();
    let success = true;
    try {
      const result = await this.executeToolInner(block, conversationId, userId);
      if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
        success = false;
      }
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      recordToolMetrics({ toolName: block.name, durationMs, success });
      if (this.db) {
        recordToolExecution(this.db, {
          toolName: block.name,
          durationMs,
          success,
          errorMessage: success ? undefined : "tool returned error",
          requestId: this.requestId,
        }).catch((err) => {
          this.logger.warn(
            { err, tool: block.name },
            "failed to persist tool execution (non-fatal)",
          );
        });
        recordActionSafe(this.db, {
          userId,
          actionType: "tool_executed",
          actionDetail: block.name,
          metadata: { durationMs, success },
        });
      }
      if (durationMs > 5000) {
        this.logger.warn({ tool: block.name, durationMs }, "slow tool execution");
      }
    }
  }

  private async executeToolInner(
    block: LlmToolUseContent,
    conversationId: string,
    userId?: string,
  ): Promise<unknown> {
    // Orchestrator-only tools handled here
    switch (block.name) {
      case "create_plan": {
        if (!this.db) return { error: "Database not available" };
        return persistPlan(this.db, conversationId, block.input as unknown as CreatePlanInput, {
          userId,
          workspaceId: this.workspaceId,
        });
      }
      case "create_milestone": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as {
          title: string;
          description: string;
          order_index?: number;
          due_date?: string;
        };
        const milestone = await createMilestone(this.db, {
          conversationId,
          title: input.title,
          description: input.description,
          orderIndex: input.order_index ?? 0,
          dueDate: input.due_date ? new Date(input.due_date) : undefined,
          createdBy: userId,
        });
        this.logger.info({ milestoneId: milestone.id }, "milestone created");
        return {
          milestoneId: milestone.id,
          title: milestone.title,
          message: `Milestone created. Use create_plan with milestone_id="${milestone.id}" to add goals to it.`,
        };
      }
      case "request_approval": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { task_id: string; reason: string };
        const approval = await createApproval(this.db, {
          taskId: input.task_id,
          requestedBy: "orchestrator",
          reason: input.reason,
        });
        this.logger.info({ approvalId: approval.id, taskId: input.task_id }, "approval requested");
        notifyApprovalCreated({
          approvalId: approval.id,
          taskId: input.task_id,
          reason: input.reason,
          requestedBy: "orchestrator",
        }).catch((err) => this.logger.warn({ err }, "approval notification failed"));
        return {
          approvalId: approval.id,
          status: "pending",
          message: `Approval requested. The user can approve with /approve ${approval.id}`,
        };
      }

      // ── Subagent delegation tools ──

      case "delegate_to_subagent": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as {
          title: string;
          instruction: string;
          wait_for_result?: boolean;
        };
        const run = await createSubagentRun(this.db, {
          parentRequestId: this.requestId,
          conversationId,
          title: input.title,
          instruction: input.instruction,
          userId,
        });
        await enqueueSubagentTask({
          subagentRunId: run.id,
          title: input.title,
          instruction: input.instruction,
          conversationId,
          userId,
          parentRequestId: this.requestId,
        });
        this.logger.info({ subagentRunId: run.id, title: input.title }, "subagent delegated");

        if (input.wait_for_result) {
          // Poll for completion (up to 5 min)
          const deadline = Date.now() + 300_000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const status = await getSubagentRun(this.db, run.id);
            if (status?.status === "completed") {
              return { subagentRunId: run.id, status: "completed", output: status.output };
            }
            if (status?.status === "failed") {
              return { subagentRunId: run.id, status: "failed", error: status.error };
            }
          }
          return {
            subagentRunId: run.id,
            status: "timeout",
            message: "Subagent still running after 5 minutes. Use check_subagent to poll later.",
          };
        }

        return {
          subagentRunId: run.id,
          status: "queued",
          message: "Subagent spawned. Use check_subagent to poll for results.",
        };
      }

      case "delegate_parallel": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as {
          tasks: Array<{ title: string; instruction: string }>;
        };
        const results = [];
        for (const task of input.tasks.slice(0, 5)) {
          const run = await createSubagentRun(this.db, {
            parentRequestId: this.requestId,
            conversationId,
            title: task.title,
            instruction: task.instruction,
            userId,
          });
          await enqueueSubagentTask({
            subagentRunId: run.id,
            title: task.title,
            instruction: task.instruction,
            conversationId,
            userId,
            parentRequestId: this.requestId,
          });
          results.push({ subagentRunId: run.id, title: task.title, status: "queued" });
        }
        this.logger.info({ count: results.length }, "parallel subagents delegated");
        return {
          subagents: results,
          message: "Use check_subagent to poll each subagent for results.",
        };
      }

      case "check_subagent": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { subagent_run_id: string };
        const run = await getSubagentRun(this.db, input.subagent_run_id);
        if (!run) return { error: "Subagent run not found" };
        return {
          subagentRunId: run.id,
          title: run.title,
          status: run.status,
          output: run.output,
          error: run.error,
          toolRounds: run.toolRounds,
          toolsUsed: run.toolsUsed,
          tokens: run.tokens,
          durationMs: run.durationMs,
        };
      }

      default: {
        // Delegate to shared tool executor with tier enforcement
        const result = await executeWithTierCheck(
          block,
          {
            db: this.db,
            embeddingService: this.embeddingService,
            n8nService: this.n8nService,
            sandboxService: this.sandboxService,
            workspaceService: this.workspaceService,
            messagingService: this.messagingService,
            autonomyTierService: this.autonomyTierService,
            projectRegistryService: this.projectRegistryService,
            monitoringService: this.monitoringService,
            browserService: this.browserService,
            gmailService: this.gmailService,
            calendarService: this.calendarService,
            episodicMemoryService: this.episodicMemoryService,
            proceduralMemoryService: this.proceduralMemoryService,
            outboundWebhookService: this.outboundWebhookService,
            conversationBranchingService: this.conversationBranchingService,
            discordService: this.discordService,
            vpsCommandService: this.vpsCommandService,
          },
          {
            conversationId,
            userId,
            workspaceId: this.workspaceId,
            agentRole: "orchestrator",
            isAutonomous: this.isAutonomous,
          } as ToolExecutorContext,
        );

        if (result === null) return { error: `Unknown tool: ${block.name}` };
        return result;
      }
    }
  }
}
