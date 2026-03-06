import type { LlmTool } from "@ai-cofounder/llm";

export const RUN_TESTS_TOOL: LlmTool = {
  name: "run_tests",
  description:
    "Run a test suite in a repository in the workspace. " +
    "Executes the specified command (default: npm test) with a timeout cap of 5 minutes. " +
    "Returns stdout, stderr, and exit code.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      command: {
        type: "string",
        description: "Test command to run (default: npm test)",
      },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds, max 300000 (default: 300000)",
      },
    },
    required: ["repo_dir"],
  },
};
