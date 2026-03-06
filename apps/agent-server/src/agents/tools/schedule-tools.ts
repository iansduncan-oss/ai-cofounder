import type { LlmTool } from "@ai-cofounder/llm";

export const CREATE_SCHEDULE_TOOL: LlmTool = {
  name: "create_schedule",
  description:
    "Create a recurring schedule that triggers autonomous work sessions. " +
    "Use standard cron expressions (e.g., '0 9 * * 1-5' for weekday mornings at 9 AM). " +
    "The action_prompt tells the AI what to do when the schedule fires.",
  input_schema: {
    type: "object",
    properties: {
      cron_expression: {
        type: "string",
        description: "Standard cron expression (minute hour day month weekday)",
      },
      action_prompt: {
        type: "string",
        description: "What the AI should do when this schedule fires (1-3 sentences)",
      },
      description: {
        type: "string",
        description: "Human-readable description of this schedule",
      },
    },
    required: ["cron_expression", "action_prompt"],
  },
};

export const LIST_SCHEDULES_TOOL: LlmTool = {
  name: "list_schedules",
  description:
    "List all configured schedules. Shows cron expression, action prompt, " +
    "whether enabled, and when it last/next runs.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const DELETE_SCHEDULE_TOOL: LlmTool = {
  name: "delete_schedule",
  description:
    "Delete a schedule by its ID. Use list_schedules first to find the ID.",
  input_schema: {
    type: "object",
    properties: {
      schedule_id: {
        type: "string",
        description: "UUID of the schedule to delete",
      },
    },
    required: ["schedule_id"],
  },
};
