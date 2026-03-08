import type { LlmTool } from "@ai-cofounder/llm";

export const VERIFY_RESULT_TOOL: LlmTool = {
  name: "submit_verification",
  description:
    "Submit your verification verdict after analyzing the goal's deliverables. " +
    "You MUST call this tool exactly once to report whether the goal's outputs are correct.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["pass", "fail"],
        description: "Whether the goal's deliverables meet the acceptance criteria",
      },
      confidence: {
        type: "number",
        description: "Your confidence in this verdict (0.0 to 1.0)",
      },
      summary: {
        type: "string",
        description: "Brief summary of what was verified and the outcome",
      },
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the check (e.g. 'tests_pass', 'code_compiles', 'no_regressions')",
            },
            passed: {
              type: "boolean",
              description: "Whether this check passed",
            },
            detail: {
              type: "string",
              description: "Optional detail about what was found",
            },
          },
          required: ["name", "passed"],
        },
        description: "Individual checks performed during verification",
      },
      suggestions: {
        type: "array",
        items: { type: "string" },
        description: "Optional suggestions for improvement if verdict is fail",
      },
    },
    required: ["verdict", "confidence", "summary", "checks"],
  },
};
