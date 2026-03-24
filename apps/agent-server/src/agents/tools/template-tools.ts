import type { LlmTool } from "@ai-cofounder/llm";

export const LIST_TEMPLATES_TOOL: LlmTool = {
  name: "list_templates",
  description:
    "List available pipeline templates. Use when the user asks " +
    "'what templates do we have', 'show available templates', 'what pipelines can I run'.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const RUN_TEMPLATE_TOOL: LlmTool = {
  name: "run_template",
  description:
    "Run a pipeline template by name. Use when the user says " +
    "'run the deploy template', 'kick off the weekly report', 'execute the X pipeline'.",
  input_schema: {
    type: "object",
    properties: {
      template_name: {
        type: "string",
        description: "Name of the pipeline template to run",
      },
      context: {
        type: "object",
        description: "Optional context variables to pass to the pipeline",
      },
    },
    required: ["template_name"],
  },
};

export const CREATE_TEMPLATE_TOOL: LlmTool = {
  name: "create_template",
  description:
    "Save a pipeline as a reusable template. Use when the user says " +
    "'save this as a template', 'create a template for this workflow'.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Unique name for the template",
      },
      stages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              enum: ["researcher", "coder", "reviewer", "planner"],
              description: "Which agent handles this stage",
            },
            prompt: {
              type: "string",
              description: "What this stage should do",
            },
            depends_on_previous: {
              type: "boolean",
              description: "Whether this stage needs the previous stage's output",
            },
          },
          required: ["agent", "prompt"],
        },
        description: "Pipeline stages in execution order",
      },
      default_context: {
        type: "object",
        description: "Optional default context variables",
      },
    },
    required: ["name", "stages"],
  },
};
