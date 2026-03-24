import type { LlmTool } from "@ai-cofounder/llm";

export const REVIEW_PR_TOOL: LlmTool = {
  name: "review_pr",
  description:
    "Review a pull request — fetches the diff, analyzes for bugs, security issues, and code quality, " +
    "and returns a structured review with file-level comments. " +
    "Use when the user says 'review PR #47', 'check that pull request', 'look at PR 12'.",
  input_schema: {
    type: "object",
    properties: {
      pr_identifier: {
        type: "string",
        description: "PR number (e.g. '47' or '#47') or branch name",
      },
      repo_dir: {
        type: "string",
        description: "Repository directory (relative to workspace). Defaults to current project repo.",
      },
    },
    required: ["pr_identifier"],
  },
};
