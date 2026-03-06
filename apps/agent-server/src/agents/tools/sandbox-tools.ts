import type { LlmTool } from "@ai-cofounder/llm";

export const EXECUTE_CODE_TOOL: LlmTool = {
  name: "execute_code",
  description:
    "Execute code in a secure Docker sandbox. Supports TypeScript, JavaScript, Python, and Bash. " +
    "Use this to test code, run scripts, validate logic, or perform calculations. " +
    "The sandbox has no network access and limited resources (256MB RAM, 30s timeout). " +
    "Returns stdout, stderr, and exit code.",
  input_schema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The code to execute",
      },
      language: {
        type: "string",
        enum: ["typescript", "javascript", "python", "bash"],
        description: "Programming language of the code",
      },
      timeout_ms: {
        type: "number",
        description: "Execution timeout in milliseconds (default: 30000, max: 60000)",
      },
    },
    required: ["code", "language"],
  },
};
