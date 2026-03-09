import type { LlmTool } from "@ai-cofounder/llm";

export const DELEGATE_TO_SUBAGENT_TOOL: LlmTool = {
  name: "delegate_to_subagent",
  description:
    "Spawn an autonomous subagent to handle a complex, multi-step task independently. " +
    "The subagent gets full tool access (files, code, git, web, memory) and runs up to 25 tool rounds. " +
    "Use for: multi-step coding tasks, research requiring multiple searches, code review across many files, " +
    "debugging that requires reading logs + code + testing fixes. " +
    "Do NOT use for simple questions or single-tool calls you can handle yourself.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short descriptive title for the task (2-8 words)",
      },
      instruction: {
        type: "string",
        description:
          "Detailed instruction for the subagent. Be specific about what to do, " +
          "what files/repos to work with, and what the expected output should be.",
      },
      wait_for_result: {
        type: "boolean",
        description:
          "If true, block and wait for the subagent to finish (up to 5 minutes). " +
          "If false, fire-and-forget — use check_subagent later to poll. Default: false.",
      },
    },
    required: ["title", "instruction"],
  },
};

export const DELEGATE_PARALLEL_TOOL: LlmTool = {
  name: "delegate_parallel",
  description:
    "Spawn multiple subagents concurrently for independent tasks. " +
    "Each subagent runs autonomously with full tool access. " +
    "Use when tasks are independent (e.g., research topic A while implementing feature B). " +
    "Maximum 5 subagents per call.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short descriptive title (2-8 words)",
            },
            instruction: {
              type: "string",
              description: "Detailed instruction for this subagent",
            },
          },
          required: ["title", "instruction"],
        },
        description: "List of independent tasks to run in parallel (max 5)",
      },
    },
    required: ["tasks"],
  },
};

export const CHECK_SUBAGENT_TOOL: LlmTool = {
  name: "check_subagent",
  description:
    "Check the status and output of a running or completed subagent. " +
    "Use this to poll for results after fire-and-forget delegation.",
  input_schema: {
    type: "object",
    properties: {
      subagent_run_id: {
        type: "string",
        description: "The ID of the subagent run to check",
      },
    },
    required: ["subagent_run_id"],
  },
};
