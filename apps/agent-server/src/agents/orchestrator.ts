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
} from "@ai-cofounder/db";
import { buildSystemPrompt } from "./prompts/system.js";
import { SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL } from "./tools/memory-tools.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "./tools/web-search.js";
import { TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL } from "./tools/n8n-tools.js";
import type { N8nService } from "../services/n8n.js";

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

/* ── Internal types ── */

interface CreatePlanInput {
  goal_title: string;
  goal_description: string;
  goal_priority: "low" | "medium" | "high" | "critical";
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

  constructor(
    registry: LlmRegistry,
    db?: Db,
    taskCategory: TaskCategory = "conversation",
    embeddingService?: EmbeddingService,
    n8nService?: N8nService,
  ) {
    this.registry = registry;
    this.db = db;
    this.taskCategory = taskCategory;
    this.embeddingService = embeddingService;
    this.n8nService = n8nService;
  }

  async run(
    message: string,
    conversationId?: string,
    history?: AgentMessage[],
    userId?: string,
  ): Promise<OrchestratorResult> {
    const id = conversationId ?? crypto.randomUUID();
    this.logger.info({ conversationId: id }, "orchestrator run started");

    // Pre-load user memories for system prompt context
    let memoryContext = "";
    if (userId && this.db) {
      const userMemories = await recallMemories(this.db, userId, { limit: 20 });
      if (userMemories.length > 0) {
        memoryContext = userMemories
          .map((m) => `- [${m.category}] ${m.key}: ${m.content}`)
          .join("\n");
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
      ? [CREATE_PLAN_TOOL, REQUEST_APPROVAL_TOOL, SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL, SEARCH_WEB_TOOL]
      : [SEARCH_WEB_TOOL];

    if (this.n8nService && this.db) {
      tools.push(TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL);
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

      const MAX_TOOL_ROUNDS = 5;
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

  private async executeTool(
    block: LlmToolUseContent,
    conversationId: string,
    userId?: string,
  ): Promise<unknown> {
    switch (block.name) {
      case "create_plan": {
        if (!this.db) return { error: "Database not available" };
        return this.persistPlan(conversationId, block.input as unknown as CreatePlanInput, userId);
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
