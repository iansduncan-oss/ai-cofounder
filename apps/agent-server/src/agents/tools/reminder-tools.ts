import type { LlmTool } from "@ai-cofounder/llm";

export const REMIND_ME_TOOL: LlmTool = {
  name: "remind_me",
  description:
    "Set a one-shot reminder for sir. Converts natural language time to a cron expression and creates " +
    "a schedule that fires once, sends the reminder message, then auto-disables. " +
    "Use this when the user says 'remind me to...', 'don't let me forget...', or 'set a reminder for...'. " +
    "Parse the time yourself: 'in 2 hours' means current time + 2h, 'tomorrow at 9am' means 0 9 next-day, etc.",
  input_schema: {
    type: "object",
    properties: {
      reminder_text: {
        type: "string",
        description: "What to remind sir about (e.g., 'check the deploy', 'call the lawyer')",
      },
      cron_expression: {
        type: "string",
        description:
          "Cron expression for when to fire. For one-shot reminders, use the specific minute/hour/day. " +
          "Examples: '30 15 * * *' for 3:30 PM today, '0 9 8 4 *' for 9 AM on April 8th.",
      },
      description: {
        type: "string",
        description: "Human-readable description (e.g., 'Reminder: check deploy at 3:30 PM')",
      },
    },
    required: ["reminder_text", "cron_expression"],
  },
};
