import type { LlmTool } from "@ai-cofounder/llm";

export const TRIGGER_N8N_WORKFLOW_TOOL: LlmTool = {
  name: "trigger_workflow",
  description:
    "Trigger an n8n automation workflow by name. Use this to send emails, post to social media, " +
    "fetch external data, interact with Shopify, or run any connected automation. " +
    "Use list_workflows first if you're not sure which workflows are available.",
  input_schema: {
    type: "object",
    properties: {
      workflow_name: {
        type: "string",
        description: "The name of the n8n workflow to trigger (must match a registered workflow)",
      },
      payload: {
        type: "object",
        description: "Data to pass to the workflow (varies per workflow — check inputSchema from list_workflows)",
      },
    },
    required: ["workflow_name", "payload"],
  },
};

export const LIST_N8N_WORKFLOWS_TOOL: LlmTool = {
  name: "list_workflows",
  description:
    "List available n8n automation workflows that can be triggered. " +
    "Returns workflow names, descriptions, and expected input schemas. " +
    "Use this to discover what automations are available before triggering one.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};
