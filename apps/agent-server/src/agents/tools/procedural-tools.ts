import type { LlmTool } from "@ai-cofounder/llm";

export const RECALL_PROCEDURES_TOOL: LlmTool = {
  name: "recall_procedures",
  description:
    "Search your procedural memory for step-by-step procedures learned from past goals. " +
    "Use this when planning similar work — it finds proven workflows that succeeded before. " +
    "Each procedure includes ordered steps, assigned agents, and success/failure counts.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Description of the task or goal to find procedures for",
      },
      limit: {
        type: "number",
        description: "Max procedures to return (default 3)",
      },
    },
    required: ["query"],
  },
};
