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

export const LIST_N8N_API_WORKFLOWS_TOOL: LlmTool = {
  name: "list_n8n_workflows",
  description:
    "List all n8n workflows via the API, including their active/inactive status. " +
    "Use this for a complete view of all workflows in n8n, not just triggerable ones.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const LIST_N8N_EXECUTIONS_TOOL: LlmTool = {
  name: "list_n8n_executions",
  description:
    "List recent n8n workflow executions. Use to check if workflows ran successfully, " +
    "find failures, or monitor automation health.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["success", "error", "waiting"],
        description: "Filter by execution status",
      },
      limit: {
        type: "number",
        description: "Number of executions to return (default 10)",
      },
    },
    required: [],
  },
};

export const TOGGLE_N8N_WORKFLOW_TOOL: LlmTool = {
  name: "toggle_n8n_workflow",
  description: "Activate or deactivate an n8n workflow.",
  input_schema: {
    type: "object",
    properties: {
      workflow_id: {
        type: "string",
        description: "The n8n workflow ID",
      },
      active: {
        type: "boolean",
        description: "true to activate, false to deactivate",
      },
    },
    required: ["workflow_id", "active"],
  },
};
