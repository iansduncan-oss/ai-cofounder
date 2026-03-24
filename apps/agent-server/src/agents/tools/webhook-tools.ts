import type { LlmTool } from "@ai-cofounder/llm";

export const REGISTER_WEBHOOK_TOOL: LlmTool = {
  name: "register_webhook",
  description:
    "Register an outbound webhook to receive notifications when events happen. " +
    "Use when the user says 'notify Slack when deploys happen', 'set up a webhook for goal completions'.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Webhook URL to POST to" },
      event_types: {
        type: "array",
        items: { type: "string" },
        description: "Event types to listen for: goal_completed, task_completed, deploy_finished, approval_needed, error_detected",
      },
      description: { type: "string", description: "Human-readable description of this webhook" },
      headers: { type: "object", description: "Optional HTTP headers to include" },
    },
    required: ["url", "event_types"],
  },
};

export const LIST_WEBHOOKS_TOOL: LlmTool = {
  name: "list_webhooks",
  description: "List all active outbound webhooks. Use when the user asks 'what webhooks are set up'.",
  input_schema: { type: "object", properties: {}, required: [] },
};
