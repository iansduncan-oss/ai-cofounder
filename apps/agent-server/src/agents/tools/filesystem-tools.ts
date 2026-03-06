import type { LlmTool } from "@ai-cofounder/llm";

export const READ_FILE_TOOL: LlmTool = {
  name: "read_file",
  description:
    "Read the contents of a file in the workspace. Use this to inspect code, configuration files, " +
    "or any text file. The path is relative to the workspace root directory.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file within the workspace (e.g., 'src/index.ts')",
      },
    },
    required: ["path"],
  },
};

export const WRITE_FILE_TOOL: LlmTool = {
  name: "write_file",
  description:
    "Write content to a file in the workspace. Creates parent directories if they don't exist. " +
    "Use this to create or overwrite files. The path is relative to the workspace root directory.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file within the workspace (e.g., 'src/index.ts')",
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};

export const LIST_DIRECTORY_TOOL: LlmTool = {
  name: "list_directory",
  description:
    "List files and subdirectories in a workspace directory. Returns names and types (file/directory). " +
    "The path is relative to the workspace root directory. Use '.' or omit for the workspace root.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the directory within the workspace (default: workspace root)",
      },
    },
    required: [],
  },
};
