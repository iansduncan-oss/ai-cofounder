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

export const DELETE_FILE_TOOL: LlmTool = {
  name: "delete_file",
  description:
    "Delete a file from the workspace. The path is relative to the workspace root directory. " +
    "This is irreversible — use with caution.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file within the workspace",
      },
    },
    required: ["path"],
  },
};

export const DELETE_DIRECTORY_TOOL: LlmTool = {
  name: "delete_directory",
  description:
    "Delete a directory from the workspace. By default only removes empty directories. " +
    "Set force=true to recursively delete a directory and all its contents. " +
    "The path is relative to the workspace root directory.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the directory within the workspace",
      },
      force: {
        type: "boolean",
        description: "If true, recursively delete non-empty directories (default: false)",
      },
    },
    required: ["path"],
  },
};

export const LIST_DIRECTORY_TOOL: LlmTool = {
  name: "list_directory",
  description:
    "List files and subdirectories in a workspace directory. Returns names, types (file/directory), and file sizes in bytes. " +
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
