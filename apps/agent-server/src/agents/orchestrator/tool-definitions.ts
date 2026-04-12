import type { LlmTool } from "@ai-cofounder/llm";
import type { GoalScope } from "@ai-cofounder/shared";

/** Tools that require explicit user approval before execution */
export const DESTRUCTIVE_TOOLS = new Set([
  "delete_file",
  "delete_directory",
  "git_push",
  "git_checkout",
]);

export interface CreatePlanInput {
  goal_title: string;
  goal_description: string;
  goal_priority: "low" | "medium" | "high" | "critical";
  milestone_id?: string;
  scope?: GoalScope;
  tasks: Array<{
    title: string;
    description: string;
    assigned_agent: "researcher" | "coder" | "reviewer" | "planner";
    parallel_group?: number;
    depends_on?: number[];
  }>;
}

export const CREATE_PLAN_TOOL: LlmTool = {
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
            depends_on: {
              type: "array",
              items: { type: "integer" },
              description:
                "Optional array of zero-based task indices that must complete before this task runs. " +
                "Enables DAG-based parallel execution. Tasks with no dependencies run as soon as possible " +
                "(up to concurrency limit). Prefer this over parallel_group for complex dependencies.",
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
      scope: {
        type: "string",
        enum: ["read_only", "local", "external", "destructive"],
        description:
          "Estimated scope of the plan's side effects: " +
          "read_only (only reads data), local (modifies local files/code), " +
          "external (sends emails, deploys, pushes code), destructive (deletes data, drops tables). " +
          "Plans with external or destructive scope require human approval before execution.",
      },
    },
    required: ["goal_title", "goal_description", "goal_priority", "tasks"],
  },
};

export const REQUEST_APPROVAL_TOOL: LlmTool = {
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
        description:
          "Clear explanation of what will happen and why approval is needed (1-3 sentences)",
      },
    },
    required: ["task_id", "reason"],
  },
};

export const CREATE_MILESTONE_TOOL: LlmTool = {
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
