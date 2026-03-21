import type { LlmTool } from "@ai-cofounder/llm";

export const RECALL_EPISODES_TOOL: LlmTool = {
  name: "recall_episodes",
  description:
    "Search your episodic memory for past conversation summaries. Use this when you need to " +
    "recall what happened in previous conversations — what was discussed, what decisions were made, " +
    "what tools were used. Helps you maintain continuity across sessions.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for in past conversation episodes",
      },
      limit: {
        type: "number",
        description: "Max episodes to return (default 5)",
      },
    },
    required: ["query"],
  },
};
