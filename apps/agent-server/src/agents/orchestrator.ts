import Anthropic from "@anthropic-ai/sdk";
import { createLogger, requireEnv, optionalEnv } from "@ai-cofounder/shared";
import type { AgentRole, AgentMessage } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { createGoal, createTask, updateGoalStatus } from "@ai-cofounder/db";

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
  usage?: { inputTokens: number; outputTokens: number };
  plan?: PlanResult;
}

/* ── Tool definition for Claude ── */

const CREATE_PLAN_TOOL: Anthropic.Tool = {
  name: "create_plan",
  description:
    "Decompose a user request into a goal with ordered tasks assigned to specialist agents. " +
    "Use this when a request involves multiple steps, requires research, code, or review, " +
    "or would benefit from structured planning. Do NOT use for simple questions.",
  input_schema: {
    type: "object" as const,
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

/* ── System prompt ── */

const SYSTEM_PROMPT = `You are the Orchestrator agent in the AI Cofounder system.
Your job is to understand what the user needs and coordinate work across specialist agents.

You have these specialist agents available:
- researcher: deep-dives into topics, gathers information, analyzes data
- coder: writes, reviews, and refactors code
- reviewer: critiques plans, deliverables, and provides quality checks
- planner: breaks complex goals into actionable step-by-step plans

WHEN TO CREATE A PLAN:
Use the create_plan tool when the request involves multiple steps, requires different types of work (research + code, planning + review, etc.), or is complex enough to benefit from structured task management.

WHEN TO RESPOND DIRECTLY:
For simple questions, quick answers, or conversational messages, respond directly without creating a plan.

When you create a plan, also include a brief text summary explaining what you're going to do and why you've structured the tasks this way.`;

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
  private client: Anthropic;
  private model: string;
  private db?: Db;

  constructor(db?: Db) {
    this.client = new Anthropic({
      apiKey: requireEnv("ANTHROPIC_API_KEY"),
    });
    this.model = optionalEnv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514");
    this.db = db;
  }

  async run(
    message: string,
    conversationId?: string,
    history?: AgentMessage[],
  ): Promise<OrchestratorResult> {
    const id = conversationId ?? crypto.randomUUID();
    this.logger.info({ conversationId: id }, "orchestrator run started");

    // Build message history for context
    const messages: Anthropic.MessageParam[] = [];

    if (history?.length) {
      for (const msg of history) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: message });

    try {
      // Include create_plan tool only when DB is available for persistence
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        ...(this.db ? { tools: [CREATE_PLAN_TOOL] } : {}),
      });

      // Extract text blocks from response
      const textBlocks = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text);

      // Check if Claude called the create_plan tool
      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === "create_plan",
      );

      // Persist plan to DB if Claude created one and we have a DB connection
      let plan: PlanResult | undefined;

      if (toolUseBlock && this.db) {
        plan = await this.persistPlan(
          id,
          toolUseBlock.input as CreatePlanInput,
        );
        this.logger.info(
          {
            conversationId: id,
            goalId: plan.goalId,
            taskCount: plan.tasks.length,
          },
          "plan created and persisted",
        );
      }

      // Build the response text
      let responseText = textBlocks.join("\n");

      if (!responseText && plan) {
        // Claude only returned a tool call with no accompanying text — generate a summary
        responseText = this.buildPlanSummary(plan);
      }

      this.logger.info(
        {
          conversationId: id,
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          hasPlan: !!plan,
        },
        "orchestrator run completed",
      );

      return {
        conversationId: id,
        agentRole: "orchestrator",
        response: responseText,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        plan,
      };
    } catch (err) {
      this.logger.error({ conversationId: id, err }, "orchestrator run failed");
      throw err;
    }
  }

  /**
   * Persist the plan (goal + tasks) to the database.
   */
  private async persistPlan(
    conversationId: string,
    input: CreatePlanInput,
  ): Promise<PlanResult> {
    const db = this.db!;

    // Create goal in draft, then activate it
    const goal = await createGoal(db, {
      conversationId,
      title: input.goal_title,
      description: input.goal_description,
      priority: input.goal_priority,
    });

    await updateGoalStatus(db, goal.id, "active");

    // Create tasks in order
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

  /**
   * Build a human-readable summary when Claude returns only a tool call.
   */
  private buildPlanSummary(plan: PlanResult): string {
    const taskLines = plan.tasks
      .map(
        (t, i) =>
          `${i + 1}. ${t.title} (${t.assignedAgent})`,
      )
      .join("\n");

    return (
      `Plan created: ${plan.goalTitle}\n\n` +
      `Tasks:\n${taskLines}`
    );
  }
}
