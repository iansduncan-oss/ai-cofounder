import type { LlmTool } from "@ai-cofounder/llm";

export const GIT_CLONE_TOOL: LlmTool = {
  name: "git_clone",
  description:
    "Clone a git repository into the workspace. Uses --depth 1 for efficiency. " +
    "The repo is cloned into a directory named after the repository (or a custom name).",
  input_schema: {
    type: "object",
    properties: {
      repo_url: {
        type: "string",
        description: "Git repository URL (HTTPS or SSH)",
      },
      directory_name: {
        type: "string",
        description: "Optional directory name for the clone (defaults to repo name)",
      },
      depth: {
        type: "number",
        description: "Clone depth for shallow clones (default: 1). Use higher values to include more history.",
      },
    },
    required: ["repo_url"],
  },
};

export const GIT_STATUS_TOOL: LlmTool = {
  name: "git_status",
  description:
    "Show the working tree status of a git repository in the workspace. " +
    "Returns short-format status showing modified, added, and untracked files.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
    },
    required: ["repo_dir"],
  },
};

export const GIT_DIFF_TOOL: LlmTool = {
  name: "git_diff",
  description:
    "Show changes in a git repository. By default shows unstaged changes; " +
    "set staged=true to show staged changes ready for commit.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      staged: {
        type: "boolean",
        description: "If true, show only staged changes (default: false)",
      },
    },
    required: ["repo_dir"],
  },
};

export const GIT_ADD_TOOL: LlmTool = {
  name: "git_add",
  description:
    "Stage files for commit in a git repository in the workspace. " +
    "Use '.' to stage all changes, or specify individual file paths.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "File paths to stage (use ['.'] to stage all changes)",
      },
    },
    required: ["repo_dir", "paths"],
  },
};

export const GIT_COMMIT_TOOL: LlmTool = {
  name: "git_commit",
  description:
    "Create a commit in a git repository in the workspace. " +
    "Make sure files are staged (git add) before committing.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      message: {
        type: "string",
        description: "Commit message describing the changes",
      },
    },
    required: ["repo_dir", "message"],
  },
};

export const GIT_PULL_TOOL: LlmTool = {
  name: "git_pull",
  description:
    "Pull latest changes from a remote in a git repository in the workspace. " +
    "Fetches and merges changes from the specified remote (default: origin).",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      remote: {
        type: "string",
        description: "Remote name to pull from (default: origin)",
      },
      branch: {
        type: "string",
        description: "Branch to pull (default: current branch)",
      },
    },
    required: ["repo_dir"],
  },
};

export const GIT_LOG_TOOL: LlmTool = {
  name: "git_log",
  description:
    "Show recent commit history of a git repository in the workspace. " +
    "Returns one-line summaries of the most recent commits.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      max_count: {
        type: "number",
        description: "Maximum number of commits to show (default: 10)",
      },
    },
    required: ["repo_dir"],
  },
};

export const GIT_BRANCH_TOOL: LlmTool = {
  name: "git_branch",
  description:
    "List or create branches in a git repository in the workspace. " +
    "Without a name, lists all branches (local and remote). With a name, creates a new branch.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      name: {
        type: "string",
        description: "Branch name to create (omit to list all branches)",
      },
    },
    required: ["repo_dir"],
  },
};

export const GIT_CHECKOUT_TOOL: LlmTool = {
  name: "git_checkout",
  description:
    "Switch branches in a git repository in the workspace. " +
    "Set create=true to create a new branch and switch to it (-b flag).",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      branch: {
        type: "string",
        description: "Branch name to switch to (or create)",
      },
      create: {
        type: "boolean",
        description: "If true, create the branch before switching (default: false)",
      },
    },
    required: ["repo_dir", "branch"],
  },
};

export const GIT_PUSH_TOOL: LlmTool = {
  name: "git_push",
  description:
    "Push commits to a remote in a git repository in the workspace. " +
    "Pushes to the specified remote (default: origin) and optionally a specific branch.",
  input_schema: {
    type: "object",
    properties: {
      repo_dir: {
        type: "string",
        description: "Relative path to the git repository within the workspace",
      },
      remote: {
        type: "string",
        description: "Remote name to push to (default: origin)",
      },
      branch: {
        type: "string",
        description: "Branch to push (default: current branch)",
      },
    },
    required: ["repo_dir"],
  },
};
