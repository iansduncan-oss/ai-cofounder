import type { LlmTool } from "@ai-cofounder/llm";

export const SAVE_MEMORY_TOOL: LlmTool = {
  name: "save_memory",
  description:
    "Save an important fact about the user for long-term recall. Use this when you learn " +
    "their name, preferences, projects they're working on, decisions they've made, " +
    "technical preferences, business context, or anything worth remembering across " +
    "conversations. Use a short, descriptive key (e.g., 'name', 'preferred_stack', 'current_project').",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [
          "user_info",
          "preferences",
          "projects",
          "decisions",
          "goals",
          "technical",
          "business",
          "other",
        ],
        description: "Category for this memory",
      },
      key: {
        type: "string",
        description: "Short label for this fact (2-4 words, snake_case)",
      },
      content: {
        type: "string",
        description: "The fact to remember (1-3 sentences)",
      },
    },
    required: ["category", "key", "content"],
  },
};

export const RECALL_MEMORIES_TOOL: LlmTool = {
  name: "recall_memories",
  description:
    "Search your long-term memory for facts about the user. Use this when you need to " +
    "recall specific information like their project details, preferences, or past decisions. " +
    "You can filter by category, search by keyword, or both.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [
          "user_info",
          "preferences",
          "projects",
          "decisions",
          "goals",
          "technical",
          "business",
          "other",
        ],
        description: "Optional category filter",
      },
      query: {
        type: "string",
        description: "Optional keyword to search across memory keys and content",
      },
      scope: {
        type: "string",
        enum: ["own", "all"],
        description:
          "Memory scope: 'own' (default) returns only your memories + shared memories, " +
          "'all' returns memories from all agents. Use 'all' when you need cross-agent context.",
      },
    },
    required: [],
  },
};
