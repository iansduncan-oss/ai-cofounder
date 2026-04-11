import type { LlmTool } from "@ai-cofounder/llm";

export const LOG_PRODUCTIVITY_TOOL: LlmTool = {
  name: "log_productivity",
  description:
    "Log or update the user's daily productivity check-in. Use this when the user mentions " +
    "what they're planning to do today, how they're feeling, their energy level, what went well, " +
    "what was challenging, or wants to reflect on their day. This updates today's productivity log " +
    "and affects their streak counter and trend charts on the dashboard.",
  input_schema: {
    type: "object",
    properties: {
      planned_items: {
        type: "array",
        description:
          "Array of tasks planned for today. Each item has 'text' and 'completed' fields. " +
          "Pass the complete list — this replaces any existing planned items for today.",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            completed: { type: "boolean" },
          },
          required: ["text", "completed"],
        },
      },
      mood: {
        type: "string",
        enum: ["great", "good", "okay", "rough", "terrible"],
        description: "How the user is feeling today",
      },
      energy_level: {
        type: "number",
        description: "Energy level from 1 (exhausted) to 5 (energized)",
      },
      highlights: {
        type: "string",
        description: "What went well today",
      },
      blockers: {
        type: "string",
        description: "What was challenging or blocking progress",
      },
      reflection_notes: {
        type: "string",
        description: "Free-form reflection notes about the day",
      },
    },
    required: [],
  },
};
