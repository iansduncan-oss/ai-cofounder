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
import { retrieve, formatContext } from "@ai-cofounder/rag";
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
  DELETE_FILE_TOOL,
  DELETE_DIRECTORY_TOOL,
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
import { buildSharedToolList, executeSharedTool } from "./tool-executor.js";
import {
  DELEGATE_TO_SUBAGENT_TOOL,
  DELEGATE_PARALLEL_TOOL,
  CHECK_SUBAGENT_TOOL,
} from "./tools/subagent-tools.js";
import {
  createSubagentRun,
  getSubagentRun,
} from "@ai-cofounder/db";
import { enqueueSubagentTask } from "@ai-cofounder/queue";

/* ── Result types ── */

export interface PlanResult {
  goalId: string;
  goalTitle: string;
  tasks: Array<{
    id: string;
    title: string;
    assignedAgent: AgentRole;
    orderIndex: number;
    parallelGroup?: number | null;
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
            parallel_group: {
              type: "integer",
              description:
                "Optional group number for parallel execution. Tasks with the same group run concurrently. " +
                "Groups execute sequentially (0 before 1 before 2). Omit to run sequentially.",
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
    parallel_group?: number;
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

    // RAG retrieval: find relevant document chunks
    const ragContext = await this.retrieveRagContext(message);
    if (ragContext) {
      memoryContext = memoryContext ? `${memoryContext}\n\n${ragContext}` : ragContext;
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

    // Build tools array: orchestrator-only tools + shared tools
    const tools: LlmTool[] = this.db
      ? [CREATE_PLAN_TOOL, CREATE_MILESTONE_TOOL, REQUEST_APPROVAL_TOOL, DELEGATE_TO_SUBAGENT_TOOL, DELEGATE_PARALLEL_TOOL, CHECK_SUBAGENT_TOOL]
      : [];

    tools.push(...buildSharedToolList({
      db: this.db,
      embeddingService: this.embeddingService,
      n8nService: this.n8nService,
      sandboxService: this.sandboxService,
      workspaceService: this.workspaceService,
    }));

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

    // RAG retrieval: find relevant document chunks
    const ragContext = await this.retrieveRagContext(message);
    if (ragContext) {
      memoryContext = memoryContext ? `${memoryContext}\n\n${ragContext}` : ragContext;
    }

    const systemPrompt = await buildSystemPrompt(memoryContext || undefined, this.db);
    const messages: LlmMessage[] = [];
    const trimmed = history?.length ? this.trimHistory(history) : [];
    for (const msg of trimmed) {
      messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
    }
    messages.push({ role: "user", content: message });

    const tools: LlmTool[] = this.db
      ? [CREATE_PLAN_TOOL, CREATE_MILESTONE_TOOL, REQUEST_APPROVAL_TOOL, DELEGATE_TO_SUBAGENT_TOOL, DELEGATE_PARALLEL_TOOL, CHECK_SUBAGENT_TOOL]
      : [];
    tools.push(...buildSharedToolList({
      db: this.db,
      embeddingService: this.embeddingService,
      n8nService: this.n8nService,
      sandboxService: this.sandboxService,
      workspaceService: this.workspaceService,
    }));

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
      case "recall_memories": {
        if (Array.isArray(result)) return `Recalled ${result.length} memories`;
        const rm = result as Record<string, unknown>;
        const memCount = Array.isArray(rm.memories) ? rm.memories.length : 0;
        const hasRag = Boolean(rm.ragContext);
        return `Recalled ${memCount} memories${hasRag ? " + RAG context" : ""}`;
      }
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
    // Orchestrator-only tools handled here
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
        }).catch(() => {});
        return {
          approvalId: approval.id,
          status: "pending",
          message: `Approval requested. The user can approve with /approve ${approval.id}`,
        };
      }

      // ── Subagent delegation tools ──

      case "delegate_to_subagent": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { title: string; instruction: string; wait_for_result?: boolean };
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
          return { subagentRunId: run.id, status: "timeout", message: "Subagent still running after 5 minutes. Use check_subagent to poll later." };
        }

        return { subagentRunId: run.id, status: "queued", message: "Subagent spawned. Use check_subagent to poll for results." };
      }

      case "delegate_parallel": {
        if (!this.db) return { error: "Database not available" };
        const input = block.input as { tasks: Array<{ title: string; instruction: string }> };
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
        return { subagents: results, message: "Use check_subagent to poll each subagent for results." };
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
        // Delegate to shared tool executor
        const result = await executeSharedTool(block, {
          db: this.db,
          embeddingService: this.embeddingService,
          n8nService: this.n8nService,
          sandboxService: this.sandboxService,
          workspaceService: this.workspaceService,
        }, { conversationId, userId });

        if (result === null) return { error: `Unknown tool: ${block.name}` };
        return result;
      }
    }
  }

  private async retrieveRagContext(query: string): Promise<string | null> {
    if (!this.db || !this.embeddingService) return null;
    try {
      const chunks = await retrieve(this.db, this.embeddingService.embed.bind(this.embeddingService), query, {
        limit: 5,
        minScore: 0.3,
        diversifySources: true,
      });
      if (chunks.length === 0) return null;
      return formatContext(chunks);
    } catch (err) {
      this.logger.warn({ err }, "RAG retrieval failed (non-fatal)");
      return null;
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
        parallelGroup: t.parallel_group,
        input: t.description,
      });

      createdTasks.push({
        id: task.id,
        title: task.title,
        assignedAgent: task.assignedAgent as AgentRole,
        orderIndex: task.orderIndex,
        parallelGroup: task.parallelGroup,
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
