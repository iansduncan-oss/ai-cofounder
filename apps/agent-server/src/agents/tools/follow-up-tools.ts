import type { LlmTool } from "@ai-cofounder/llm";

export const CREATE_FOLLOW_UP_TOOL: LlmTool = {
  name: "create_follow_up",
  description:
    "Create a follow-up item to track something that needs attention later. " +
    "Use this when the user mentions something they need to do, check on, or revisit. " +
    "A daily reminder job will notify them when due items are overdue.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short title for the follow-up (e.g., 'Review PR #42')",
      },
      description: {
        type: "string",
        description: "Optional detailed description or context",
      },
      due_date: {
        type: "string",
        description: "ISO 8601 date/time when this is due (e.g., '2025-01-15T09:00:00Z'). Optional.",
      },
      source: {
        type: "string",
        description: "Where this follow-up originated (e.g., 'conversation', 'goal', 'meeting')",
      },
    },
    required: ["title"],
  },
};
