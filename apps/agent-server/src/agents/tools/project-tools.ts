import type { LlmTool } from "@ai-cofounder/llm";

export const REGISTER_PROJECT_TOOL: LlmTool = {
  name: "register_project",
  description:
    "Register a local project (codebase) so the agent can manage it, ingest its documentation, " +
    "and perform workspace operations on it. The workspace_path must be inside the allowed base " +
    "directories configured on the server. After registering, use switch_project to make it active.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Human-readable project name (e.g., 'AI Cofounder', 'Clip Automation')",
      },
      workspace_path: {
        type: "string",
        description: "Absolute path to the project's root directory on the server",
      },
      repo_url: {
        type: "string",
        description: "Optional Git remote URL (e.g., git@github.com:owner/repo.git)",
      },
      description: {
        type: "string",
        description: "Optional short description of what this project does",
      },
      language: {
        type: "string",
        enum: ["typescript", "python", "javascript", "go", "other"],
        description: "Primary programming language (default: typescript)",
      },
      test_command: {
        type: "string",
        description: "Optional command to run tests (e.g., 'npm test')",
      },
      default_branch: {
        type: "string",
        description: "Default git branch (default: main)",
      },
    },
    required: ["name", "workspace_path"],
  },
};

export const SWITCH_PROJECT_TOOL: LlmTool = {
  name: "switch_project",
  description:
    "Switch the active project for the current conversation. " +
    "After switching, subsequent workspace operations and RAG retrieval will be scoped to the selected project. " +
    "Use list_projects to see available project names.",
  input_schema: {
    type: "object",
    properties: {
      project_name: {
        type: "string",
        description: "Name of the project to switch to (must match a registered project name exactly)",
      },
    },
    required: ["project_name"],
  },
};

export const LIST_PROJECTS_TOOL: LlmTool = {
  name: "list_projects",
  description:
    "List all registered projects with their names, languages, and workspace paths. " +
    "Use this to see what projects are available before using switch_project.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const ANALYZE_CROSS_PROJECT_IMPACT_TOOL: LlmTool = {
  name: "analyze_cross_project_impact",
  description:
    "Analyze the potential impact of a proposed change on dependent projects. " +
    "Returns a dependency map showing which projects depend on the specified project, " +
    "their dependency types, and descriptions. Use this before making breaking changes.",
  input_schema: {
    type: "object",
    properties: {
      project_name: {
        type: "string",
        description: "Name of the project being changed",
      },
      change_description: {
        type: "string",
        description: "Description of the proposed change (e.g., 'updating the API contract for /api/agents/run')",
      },
    },
    required: ["project_name", "change_description"],
  },
};
