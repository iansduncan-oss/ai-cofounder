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
import { createLogger } from "@ai-cofounder/shared";
import type { AgentRole, AgentMessage } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  createGoal,
  createTask,
  updateGoalStatus,
  saveMemory,
  recallMemories,
  searchMemoriesByVector,
  createApproval,
  getN8nWorkflowByName,
  listN8nWorkflows,
  saveCodeExecution,
  createSchedule,
  listSchedules,
  deleteSchedule,
  createMilestone,
  touchMemory,
  recordToolExecution,
} from "@ai-cofounder/db";
import { buildSystemPrompt } from "./prompts/system.js";
import { recordToolMetrics } from "../plugins/observability.js";
import { SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL } from "./tools/memory-tools.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "./tools/web-search.js";
import { BROWSE_WEB_TOOL, executeBrowseWeb } from "./tools/browse-web.js";
import { TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL } from "./tools/n8n-tools.js";
import { EXECUTE_CODE_TOOL } from "./tools/sandbox-tools.js";
import {
  CREATE_SCHEDULE_TOOL,
  LIST_SCHEDULES_TOOL,
  DELETE_SCHEDULE_TOOL,
} from "./tools/schedule-tools.js";
import {
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
} from "./tools/filesystem-tools.js";
import {
  GIT_CLONE_TOOL,
  GIT_STATUS_TOOL,
  GIT_DIFF_TOOL,
  GIT_ADD_TOOL,
  GIT_COMMIT_TOOL,
  GIT_PULL_TOOL,
  GIT_LOG_TOOL,
  GIT_BRANCH_TOOL,
  GIT_CHECKOUT_TOOL,
  GIT_PUSH_TOOL,
} from "./tools/git-tools.js";
import { RUN_TESTS_TOOL } from "./tools/workspace-tools.js";
import { CREATE_PR_TOOL, executeCreatePr } from "./tools/github-tools.js";
import type { CreatePrInput } from "./tools/github-tools.js";
import type { StreamCallback } from "./stream-events.js";
import type { N8nService } from "../services/n8n.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { notifyApprovalCreated } from "../services/notifications.js";

/* ── Result types ── */

export interface PlanResult {
  goalId: string;
  goalTitle: string;
  tasks: Array<{
    id: string;
    title: string;
    assignedAgent: AgentRole;
    orderIndex: number;
  }>;
}

export interface OrchestratorResult {
  conversationId: string;
  agentRole: AgentRole;
  response: string;
  model: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number };
  plan?: PlanResult;
}

/* ── Tool definition for LLM ── */

const CREATE_PLAN_TOOL: LlmTool = {
  name: "create_plan",
  description:
    "Decompose a user request into a goal with ordered tasks assigned to specialist agents. " +
    "Use this when a request involves multiple steps, requires research, code, or review, " +
    "or would benefit from structured planning. Do NOT use for simple questions.",
  input_schema: {
    type: "object",
    properties: {
      goal_title: {
        type: "string",
        description: "Concise title for the overall goal (2-8 words)",
      },
      goal_description: {
        type: "string",
        description: "Full description of what needs to be accomplished",
      },
      goal_priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Priority level based on urgency and importance",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short task title (2-8 words)",
            },
            description: {
              type: "string",
              description: "What this task involves and expected output",
            },
            assigned_agent: {
              type: "string",
              enum: ["researcher", "coder", "reviewer", "planner"],
              description:
                "Which specialist agent should handle this task: " +
                "researcher (gather info), coder (write/edit code), " +
                "reviewer (critique/validate), planner (break down further)",
            },
          },
          required: ["title", "description", "assigned_agent"],
        },
        description: "Ordered list of tasks to complete the goal",
      },
      milestone_id: {
        type: "string",
        description: "Optional milestone ID to associate this goal with (from create_milestone)",
      },
    },
    required: ["goal_title", "goal_description", "goal_priority", "tasks"],
  },
};

const REQUEST_APPROVAL_TOOL: LlmTool = {
  name: "request_approval",
  description:
    "Request human approval before executing a sensitive or high-impact action. " +
    "Use this when a plan involves: deploying code, spending money, sending external communications, " +
    "deleting data, changing infrastructure, or any action that's hard to reverse. " +
    "The user will be notified and must approve via Discord before execution continues.",
  input_schema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "ID of the task that needs approval (from a previously created plan)",
      },
      reason: {
        type: "string",
        description: "Clear explanation of what will happen and why approval is needed (1-3 sentences)",
      },
    },
    required: ["task_id", "reason"],
  },
};

const CREATE_MILESTONE_TOOL: LlmTool = {
  name: "create_milestone",
  description:
    "Create a milestone that groups related goals into a phased plan with dependencies. " +
    "Use this for complex multi-step projects that span multiple goals. " +
    "After creating a milestone, use create_plan to add goals to it.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Milestone title describing the overall objective",
      },
      description: {
        type: "string",
        description: "Full description of what this milestone achieves",
      },
      order_index: {
        type: "number",
        description: "Order in the overall project plan (0-based)",
      },
      due_date: {
        type: "string",
        description: "Optional target date in ISO-8601 format",
      },
    },
    required: ["title", "description"],
  },
};

/* ── Internal types ── */

interface CreatePlanInput {
  goal_title: string;
  goal_description: string;
  goal_priority: "low" | "medium" | "high" | "critical";
  milestone_id?: string;
  tasks: Array<{
    title: string;
    description: string;
    assigned_agent: "researcher" | "coder" | "reviewer" | "planner";
  }>;
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
  private requestId?: string;

  constructor(
    registry: LlmRegistry,
    db?: Db,
    taskCategory: TaskCategory = "conversation",
    embeddingService?: EmbeddingService,
    n8nService?: N8nService,
    sandboxService?: SandboxService,
    workspaceService?: WorkspaceService,
  ) {
    this.registry = registry;
    this.db = db;
    this.taskCategory = taskCategory;
    this.embeddingService = embeddingService;
    this.n8nService = n8nService;
    this.sandboxService = sandboxService;
    this.workspaceService = workspaceService;
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

    // Pre-load user memories for system prompt context
    let memoryContext = "";
    if (userId && this.db) {
      const userMemories = await recallMemories(this.db, userId, { limit: 20 });

      // Auto semantic retrieval: find memories relevant to the current message
      let relevantMemories: Array<{ id: string; category: string; key: string; content: string }> = [];
      if (this.embeddingService) {
        try {
          const queryEmbedding = await this.embeddingService.embed(message);
          const vectorResults = await searchMemoriesByVector(this.db, queryEmbedding, userId, 5);
          relevantMemories = vectorResults.map((m) => ({
            id: m.id,
            category: m.category,
            key: m.key,
            content: m.content,
          }));
        } catch (err) {
          this.logger.warn({ err }, "auto semantic memory retrieval failed (non-fatal)");
        }
      }

      // Merge: relevant first, then importance-based (dedupe by ID)
      const seenIds = new Set(relevantMemories.map((m) => m.id));
      const generalMemories = userMemories.filter((m) => !seenIds.has(m.id));

      const parts: string[] = [];
      if (relevantMemories.length > 0) {
        parts.push("Relevant to this conversation:");
        parts.push(...relevantMemories.map((m) => `- [${m.category}] ${m.key}: ${m.content}`));
      }
      if (generalMemories.length > 0) {
        if (parts.length > 0) parts.push("");
        parts.push("General knowledge:");
        parts.push(...generalMemories.map((m) => `- [${m.category}] ${m.key}: ${m.content}`));
      }
      if (parts.length > 0) {
        memoryContext = parts.join("\n");
      }
    }

    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);

    // Build message history for context
    const messages: LlmMessage[] = [];

    const trimmed = history?.length ? this.trimHistory(history) : [];
    if (trimmed.length) {
      for (const msg of trimmed) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: message });

    // Build tools array (all tools when DB available)
    const tools: LlmTool[] = this.db
      ? [CREATE_PLAN_TOOL, CREATE_MILESTONE_TOOL, REQUEST_APPROVAL_TOOL, SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL, SEARCH_WEB_TOOL, BROWSE_WEB_TOOL]
      : [SEARCH_WEB_TOOL, BROWSE_WEB_TOOL];

    if (this.n8nService && this.db) {
      tools.push(TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL);
    }

    if (this.sandboxService?.available) {
      tools.push(EXECUTE_CODE_TOOL);
    }

    if (this.db) {
      tools.push(CREATE_SCHEDULE_TOOL, LIST_SCHEDULES_TOOL, DELETE_SCHEDULE_TOOL);
    }

    if (this.workspaceService) {
      tools.push(READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL);
      tools.push(GIT_CLONE_TOOL, GIT_STATUS_TOOL, GIT_DIFF_TOOL, GIT_ADD_TOOL, GIT_COMMIT_TOOL, GIT_PULL_TOOL, GIT_LOG_TOOL);
      tools.push(GIT_BRANCH_TOOL, GIT_CHECKOUT_TOOL, GIT_PUSH_TOOL, RUN_TESTS_TOOL, CREATE_PR_TOOL);
    }

    try {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let plan: PlanResult | undefined;
      // Agentic tool-use loop
      let response = await this.registry.complete(this.taskCategory, {
        system: systemPrompt,
        messages,
        tools,
        max_tokens: 4096,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      const providerName = response.provider;

      const MAX_TOOL_ROUNDS = 10;
      let round = 0;

      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            this.logger.info({ tool: block.name, conversationId: id }, "executing tool");
            const result = await this.executeTool(block, id, userId);

            // If create_plan returned a plan, capture it
            if (block.name === "create_plan" && result && "goalId" in (result as object)) {
              plan = result as PlanResult;
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        // Continue the conversation with tool results
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        response = await this.registry.complete(this.taskCategory, {
          system: systemPrompt,
          messages,
          tools,
          max_tokens: 4096,
        });

        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Extract final text response
      const textBlocks = response.content
        .filter((block): block is LlmTextContent => block.type === "text")
        .map((block) => block.text);

      let responseText = textBlocks.join("\n");

      if (!responseText && plan) {
        responseText = this.buildPlanSummary(plan);
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
  ): Promise<OrchestratorResult> {
    this.requestId = requestId;
    const id = conversationId ?? crypto.randomUUID();

    await onEvent({ type: "thinking", data: { round: 0, message: "Loading context..." } });

    // Reuse run() setup: memory loading
    let memoryContext = "";
    if (userId && this.db) {
      const userMemories = await recallMemories(this.db, userId, { limit: 20 });
      let relevantMemories: Array<{ id: string; category: string; key: string; content: string }> = [];
      if (this.embeddingService) {
        try {
          const queryEmbedding = await this.embeddingService.embed(message);
          const vectorResults = await searchMemoriesByVector(this.db, queryEmbedding, userId, 5);
          relevantMemories = vectorResults.map((m) => ({ id: m.id, category: m.category, key: m.key, content: m.content }));
        } catch { /* non-fatal */ }
      }
      const seenIds = new Set(relevantMemories.map((m) => m.id));
      const generalMemories = userMemories.filter((m) => !seenIds.has(m.id));
      const parts: string[] = [];
      if (relevantMemories.length > 0) {
        parts.push("Relevant to this conversation:");
        parts.push(...relevantMemories.map((m) => `- [${m.category}] ${m.key}: ${m.content}`));
      }
      if (generalMemories.length > 0) {
        if (parts.length > 0) parts.push("");
        parts.push("General knowledge:");
        parts.push(...generalMemories.map((m) => `- [${m.category}] ${m.key}: ${m.content}`));
      }
      if (parts.length > 0) memoryContext = parts.join("\n");
    }

    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);
    const messages: LlmMessage[] = [];
    const trimmed = history?.length ? this.trimHistory(history) : [];
    for (const msg of trimmed) {
      messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
    }
    messages.push({ role: "user", content: message });

    const tools: LlmTool[] = this.db
      ? [CREATE_PLAN_TOOL, CREATE_MILESTONE_TOOL, REQUEST_APPROVAL_TOOL, SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL, SEARCH_WEB_TOOL, BROWSE_WEB_TOOL]
      : [SEARCH_WEB_TOOL, BROWSE_WEB_TOOL];
    if (this.n8nService && this.db) tools.push(TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL);
    if (this.sandboxService?.available) tools.push(EXECUTE_CODE_TOOL);
    if (this.db) tools.push(CREATE_SCHEDULE_TOOL, LIST_SCHEDULES_TOOL, DELETE_SCHEDULE_TOOL);
    if (this.workspaceService) {
      tools.push(READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL);
      tools.push(GIT_CLONE_TOOL, GIT_STATUS_TOOL, GIT_DIFF_TOOL, GIT_ADD_TOOL, GIT_COMMIT_TOOL, GIT_PULL_TOOL, GIT_LOG_TOOL);
      tools.push(GIT_BRANCH_TOOL, GIT_CHECKOUT_TOOL, GIT_PUSH_TOOL, RUN_TESTS_TOOL, CREATE_PR_TOOL);
    }

    try {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let plan: PlanResult | undefined;

      await onEvent({ type: "thinking", data: { round: 1, message: "Generating response..." } });

      let response = await this.registry.complete(this.taskCategory, { system: systemPrompt, messages, tools, max_tokens: 4096 });
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      const providerName = response.provider;

      const MAX_TOOL_ROUNDS = 10;
      let round = 0;

      while (response.stop_reason === "tool_use" && round < MAX_TOOL_ROUNDS) {
        round++;
        const toolResults: LlmToolResultContent[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            const toolInput = block.input as Record<string, unknown>;
            await onEvent({ type: "tool_call", data: { tool: block.name, input: this.sanitizeToolInput(toolInput) } });

            const result = await this.executeTool(block, id, userId);
            if (block.name === "create_plan" && result && "goalId" in (result as object)) {
              plan = result as PlanResult;
            }

            await onEvent({ type: "tool_result", data: { tool: block.name, summary: this.summarizeToolResult(block.name, result) } });
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }

        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        await onEvent({ type: "thinking", data: { round: round + 1, message: `Processing (round ${round + 1})...` } });
        response = await this.registry.complete(this.taskCategory, { system: systemPrompt, messages, tools, max_tokens: 4096 });
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      const textBlocks = response.content.filter((b): b is LlmTextContent => b.type === "text").map((b) => b.text);
      let responseText = textBlocks.join("\n");
      if (!responseText && plan) responseText = this.buildPlanSummary(plan);

      // Emit text in chunks for progressive rendering
      const CHUNK_SIZE = 100;
      for (let i = 0; i < responseText.length; i += CHUNK_SIZE) {
        await onEvent({ type: "text_delta", data: { text: responseText.slice(i, i + CHUNK_SIZE) } });
      }
      await onEvent({ type: "done", data: { response: responseText, model: response.model, provider: providerName, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } } });

      return { conversationId: id, agentRole: "orchestrator", response: responseText, model: response.model, provider: providerName, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, plan };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await onEvent({ type: "error", data: { error: errorMsg } });
      throw err;
    }
  }

  private sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" && value.length > 200) {
        sanitized[key] = value.slice(0, 200) + "...";
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private summarizeToolResult(toolName: string, result: unknown): string {
    if (!result || typeof result !== "object") return "completed";
    const r = result as Record<string, unknown>;
    if (r.error) return `error: ${String(r.error).slice(0, 100)}`;
    switch (toolName) {
      case "create_plan": return `Plan created: ${r.goalTitle ?? ""}`;
      case "search_web": return `Found results`;
      case "save_memory": return `Saved: ${r.key ?? ""}`;
      case "recall_memories": return `Recalled ${Array.isArray(result) ? result.length : 0} memories`;
      case "execute_code": return `Exit code: ${r.exitCode ?? "?"}`;
      case "read_file": return `Read: ${r.path ?? ""}`;
      case "write_file": return `Wrote: ${r.path ?? ""}`;
      default: return "completed";
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
          this.logger.warn({ err, tool: block.name }, "failed to persist tool execution (non-fatal)");
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
    switch (block.name) {
      case "create_plan": {
        if (!this.db) return { error: "Database not available" };
        return this.persistPlan(conversationId, block.input as unknown as CreatePlanInput, userId);
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
      case "save_memory": {
        if (!userId || !this.db) return { error: "No user context available" };
        const input = block.input as {
          category: string;
          key: string;
          content: string;
        };
        let embedding: number[] | undefined;
        if (this.embeddingService) {
          try {
            embedding = await this.embeddingService.embed(`${input.key}: ${input.content}`);
          } catch (err) {
            this.logger.warn({ err }, "failed to generate embedding for memory, saving without");
          }
        }
        const mem = await saveMemory(this.db, {
          userId,
          category: input.category as Parameters<typeof saveMemory>[1]["category"],
          key: input.key,
          content: input.content,
          source: conversationId,
          embedding,
        });
        return { saved: true, key: mem.key, category: mem.category };
      }
      case "recall_memories": {
        if (!userId || !this.db) return { error: "No user context available" };
        const input = block.input as { category?: string; query?: string };

        // Use vector search when query is provided and embedding service is available
        if (input.query && this.embeddingService) {
          try {
            const queryEmbedding = await this.embeddingService.embed(input.query);
            const results = await searchMemoriesByVector(this.db, queryEmbedding, userId, 10);
            if (results.length > 0) {
              // Touch recalled memories async (non-fatal)
              for (const m of results) {
                touchMemory(this.db!, m.id).catch(() => {});
              }
              return results.map((m) => ({
                key: m.key,
                category: m.category,
                content: m.content,
                updatedAt: m.updated_at,
                distance: m.distance,
              }));
            }
          } catch (err) {
            this.logger.warn({ err }, "vector search failed, falling back to text search");
          }
        }

        // Fallback to ILIKE text search
        const memories = await recallMemories(this.db, userId, input);
        // Touch recalled memories async (non-fatal)
        for (const m of memories) {
          touchMemory(this.db!, m.id).catch(() => {});
        }
        return memories.map((m) => ({
          key: m.key,
          category: m.category,
          content: m.content,
          updatedAt: m.updatedAt,
        }));
      }
      case "request_approval": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { task_id: string; reason: string };
        const approval = await createApproval(this.db, {
          taskId: input.task_id,
          requestedBy: "orchestrator",
          reason: input.reason,
        });
        this.logger.info(
          { approvalId: approval.id, taskId: input.task_id },
          "approval requested",
        );
        // Send proactive Slack notification (async, non-fatal)
        notifyApprovalCreated({
          approvalId: approval.id,
          taskId: input.task_id,
          reason: input.reason,
          requestedBy: "orchestrator",
        }).catch(() => {});
        return {
          approvalId: approval.id,
          status: "pending",
          message: `Approval requested. The user can approve with /approve ${approval.id}`,
        };
      }
      case "search_web": {
        const input = block.input as { query: string; max_results?: number };
        return executeWebSearch(input.query, input.max_results);
      }
      case "browse_web": {
        const input = block.input as { url: string; max_length?: number };
        return executeBrowseWeb(input.url, input.max_length);
      }
      case "trigger_workflow": {
        if (!this.n8nService || !this.db) return { error: "n8n integration not available" };
        const input = block.input as { workflow_name: string; payload: Record<string, unknown> };
        const workflow = await getN8nWorkflowByName(this.db, input.workflow_name);
        if (!workflow) return { error: `Workflow "${input.workflow_name}" not found` };
        if (workflow.direction === "inbound") {
          return { error: `Workflow "${input.workflow_name}" is inbound-only and cannot be triggered` };
        }
        return this.n8nService.trigger(workflow.webhookUrl, workflow.name, input.payload);
      }
      case "list_workflows": {
        if (!this.db) return { error: "Database not available" };
        const workflows = await listN8nWorkflows(this.db, "outbound");
        return workflows.map((w) => ({
          name: w.name,
          description: w.description,
          inputSchema: w.inputSchema,
        }));
      }
      case "create_schedule": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { cron_expression: string; action_prompt: string; description?: string };
        try {
          const { CronExpressionParser } = await import("cron-parser");
          const interval = CronExpressionParser.parse(input.cron_expression);
          const nextRunAt = interval.next().toDate();
          const schedule = await createSchedule(this.db, {
            cronExpression: input.cron_expression,
            actionPrompt: input.action_prompt,
            description: input.description,
            userId,
            enabled: true,
            nextRunAt,
          });
          return {
            scheduleId: schedule.id,
            cronExpression: schedule.cronExpression,
            nextRunAt: nextRunAt.toISOString(),
            message: `Schedule created: ${input.description ?? input.action_prompt}`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Invalid cron expression: ${msg}` };
        }
      }
      case "list_schedules": {
        if (!this.db) return { error: "Database not available" };
        const allSchedules = await listSchedules(this.db, userId);
        return allSchedules.map((s) => ({
          id: s.id,
          cronExpression: s.cronExpression,
          actionPrompt: s.actionPrompt,
          description: s.description,
          enabled: s.enabled,
          lastRunAt: s.lastRunAt,
          nextRunAt: s.nextRunAt,
        }));
      }
      case "delete_schedule": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { schedule_id: string };
        const deleted = await deleteSchedule(this.db, input.schedule_id);
        if (!deleted) return { error: "Schedule not found" };
        return { deleted: true, scheduleId: input.schedule_id };
      }
      case "execute_code": {
        if (!this.sandboxService?.available) return { error: "Sandbox execution not available" };
        const input = block.input as { code: string; language: string; timeout_ms?: number };
        const timeoutMs = Math.min(input.timeout_ms ?? 30_000, 60_000);
        const result = await this.sandboxService.execute({
          code: input.code,
          language: input.language as "typescript" | "javascript" | "python" | "bash",
          timeoutMs,
        });
        // Persist execution result if DB is available
        if (this.db) {
          try {
            const { hashCode } = await import("@ai-cofounder/sandbox");
            await saveCodeExecution(this.db, {
              language: input.language,
              codeHash: hashCode(input.code),
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              durationMs: result.durationMs,
              timedOut: result.timedOut,
            });
          } catch (err) {
            this.logger.warn({ err }, "failed to persist code execution result");
          }
        }
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          language: result.language,
        };
      }
      case "read_file": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { path: string };
        try {
          const content = await this.workspaceService.readFile(input.path);
          return { path: input.path, content };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      }
      case "write_file": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { path: string; content: string };
        try {
          await this.workspaceService.writeFile(input.path, input.content);
          return { written: true, path: input.path };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      }
      case "list_directory": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { path?: string };
        try {
          const entries = await this.workspaceService.listDirectory(input.path);
          return { path: input.path ?? ".", entries };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      }
      case "git_clone": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_url: string; directory_name?: string };
        const result = await this.workspaceService.gitClone(input.repo_url, input.directory_name);
        return { ...result, repoUrl: input.repo_url };
      }
      case "git_status": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string };
        return this.workspaceService.gitStatus(input.repo_dir);
      }
      case "git_diff": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; staged?: boolean };
        return this.workspaceService.gitDiff(input.repo_dir, input.staged);
      }
      case "git_add": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; paths: string[] };
        return this.workspaceService.gitAdd(input.repo_dir, input.paths);
      }
      case "git_commit": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; message: string };
        return this.workspaceService.gitCommit(input.repo_dir, input.message);
      }
      case "git_pull": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; remote?: string; branch?: string };
        return this.workspaceService.gitPull(input.repo_dir, input.remote, input.branch);
      }
      case "git_log": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; max_count?: number };
        return this.workspaceService.gitLog(input.repo_dir, input.max_count);
      }
      case "git_branch": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; name?: string };
        return this.workspaceService.gitBranch(input.repo_dir, input.name);
      }
      case "git_checkout": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; branch: string; create?: boolean };
        return this.workspaceService.gitCheckout(input.repo_dir, input.branch, input.create);
      }
      case "git_push": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; remote?: string; branch?: string };
        return this.workspaceService.gitPush(input.repo_dir, input.remote, input.branch);
      }
      case "run_tests": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as { repo_dir: string; command?: string; timeout_ms?: number };
        return this.workspaceService.runTests(input.repo_dir, input.command, input.timeout_ms);
      }
      case "create_pr": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const input = block.input as unknown as CreatePrInput;
        return executeCreatePr(input);
      }
      default:
        return { error: `Unknown tool: ${block.name}` };
    }
  }

  private trimHistory(history: AgentMessage[], maxTokenEstimate = 80_000): AgentMessage[] {
    let tokenCount = 0;
    const trimmed: AgentMessage[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const est = Math.ceil(history[i].content.length / 4);
      if (tokenCount + est > maxTokenEstimate) break;
      tokenCount += est;
      trimmed.unshift(history[i]);
    }
    return trimmed;
  }

  private async persistPlan(conversationId: string, input: CreatePlanInput, userId?: string): Promise<PlanResult> {
    const db = this.db!;

    const goal = await createGoal(db, {
      conversationId,
      title: input.goal_title,
      description: input.goal_description,
      priority: input.goal_priority,
      createdBy: userId,
      milestoneId: input.milestone_id,
    });

    await updateGoalStatus(db, goal.id, "active");

    const createdTasks: PlanResult["tasks"] = [];

    for (let i = 0; i < input.tasks.length; i++) {
      const t = input.tasks[i];
      const task = await createTask(db, {
        goalId: goal.id,
        title: t.title,
        description: t.description,
        assignedAgent: t.assigned_agent,
        orderIndex: i,
        input: t.description,
      });

      createdTasks.push({
        id: task.id,
        title: task.title,
        assignedAgent: task.assignedAgent as AgentRole,
        orderIndex: task.orderIndex,
      });
    }

    return {
      goalId: goal.id,
      goalTitle: goal.title,
      tasks: createdTasks,
    };
  }

  private buildPlanSummary(plan: PlanResult): string {
    const taskLines = plan.tasks
      .map((t, i) => `${i + 1}. ${t.title} (${t.assignedAgent})`)
      .join("\n");

    return `Plan created: ${plan.goalTitle}\n\nTasks:\n${taskLines}`;
  }
}
