import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: vi.fn(),
}));

const { READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL } =
  await import("../agents/tools/filesystem-tools.js");

const {
  GIT_CLONE_TOOL,
  GIT_STATUS_TOOL,
  GIT_DIFF_TOOL,
  GIT_ADD_TOOL,
  GIT_COMMIT_TOOL,
  GIT_PULL_TOOL,
  GIT_LOG_TOOL,
  GIT_BRANCH_TOOL,
  GIT_CHECKOUT_TOOL,
  GIT_PUSH_TOOL,
} = await import("../agents/tools/git-tools.js");

const { RUN_TESTS_TOOL } = await import("../agents/tools/workspace-tools.js");
const { CREATE_PR_TOOL } = await import("../agents/tools/github-tools.js");
const { BROWSE_WEB_TOOL } = await import("../agents/tools/browse-web.js");

describe("Filesystem Tool Definitions", () => {
  describe("READ_FILE_TOOL", () => {
    it("has the correct name", () => {
      expect(READ_FILE_TOOL.name).toBe("read_file");
    });

    it("has a non-empty description", () => {
      expect(READ_FILE_TOOL.description.length).toBeGreaterThan(20);
    });

    it("requires path", () => {
      expect(READ_FILE_TOOL.input_schema.required).toContain("path");
    });

    it("defines path as string", () => {
      expect(READ_FILE_TOOL.input_schema.properties.path.type).toBe("string");
    });
  });

  describe("WRITE_FILE_TOOL", () => {
    it("has the correct name", () => {
      expect(WRITE_FILE_TOOL.name).toBe("write_file");
    });

    it("requires path and content", () => {
      expect(WRITE_FILE_TOOL.input_schema.required).toContain("path");
      expect(WRITE_FILE_TOOL.input_schema.required).toContain("content");
    });

    it("defines content as string", () => {
      expect(WRITE_FILE_TOOL.input_schema.properties.content.type).toBe("string");
    });
  });

  describe("LIST_DIRECTORY_TOOL", () => {
    it("has the correct name", () => {
      expect(LIST_DIRECTORY_TOOL.name).toBe("list_directory");
    });

    it("has no required parameters", () => {
      expect(LIST_DIRECTORY_TOOL.input_schema.required).toEqual([]);
    });

    it("has optional path parameter", () => {
      expect(LIST_DIRECTORY_TOOL.input_schema.properties.path.type).toBe("string");
      expect(LIST_DIRECTORY_TOOL.input_schema.required).not.toContain("path");
    });
  });
});

describe("Git Tool Definitions", () => {
  describe("GIT_CLONE_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_CLONE_TOOL.name).toBe("git_clone");
    });

    it("requires repo_url", () => {
      expect(GIT_CLONE_TOOL.input_schema.required).toContain("repo_url");
    });

    it("has optional directory_name", () => {
      expect(GIT_CLONE_TOOL.input_schema.properties.directory_name).toBeDefined();
      expect(GIT_CLONE_TOOL.input_schema.required).not.toContain("directory_name");
    });
  });

  describe("GIT_STATUS_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_STATUS_TOOL.name).toBe("git_status");
    });

    it("requires repo_dir", () => {
      expect(GIT_STATUS_TOOL.input_schema.required).toContain("repo_dir");
    });
  });

  describe("GIT_DIFF_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_DIFF_TOOL.name).toBe("git_diff");
    });

    it("requires repo_dir", () => {
      expect(GIT_DIFF_TOOL.input_schema.required).toContain("repo_dir");
    });

    it("has optional staged boolean", () => {
      expect(GIT_DIFF_TOOL.input_schema.properties.staged.type).toBe("boolean");
      expect(GIT_DIFF_TOOL.input_schema.required).not.toContain("staged");
    });
  });

  describe("GIT_ADD_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_ADD_TOOL.name).toBe("git_add");
    });

    it("requires repo_dir and paths", () => {
      expect(GIT_ADD_TOOL.input_schema.required).toContain("repo_dir");
      expect(GIT_ADD_TOOL.input_schema.required).toContain("paths");
    });

    it("defines paths as array of strings", () => {
      expect(GIT_ADD_TOOL.input_schema.properties.paths.type).toBe("array");
      expect(GIT_ADD_TOOL.input_schema.properties.paths.items.type).toBe("string");
    });
  });

  describe("GIT_COMMIT_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_COMMIT_TOOL.name).toBe("git_commit");
    });

    it("requires repo_dir and message", () => {
      expect(GIT_COMMIT_TOOL.input_schema.required).toContain("repo_dir");
      expect(GIT_COMMIT_TOOL.input_schema.required).toContain("message");
    });
  });

  describe("GIT_PULL_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_PULL_TOOL.name).toBe("git_pull");
    });

    it("requires repo_dir", () => {
      expect(GIT_PULL_TOOL.input_schema.required).toContain("repo_dir");
    });

    it("has optional remote string", () => {
      expect(GIT_PULL_TOOL.input_schema.properties.remote.type).toBe("string");
      expect(GIT_PULL_TOOL.input_schema.required).not.toContain("remote");
    });

    it("has optional branch string", () => {
      expect(GIT_PULL_TOOL.input_schema.properties.branch.type).toBe("string");
      expect(GIT_PULL_TOOL.input_schema.required).not.toContain("branch");
    });
  });

  describe("GIT_LOG_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_LOG_TOOL.name).toBe("git_log");
    });

    it("requires repo_dir", () => {
      expect(GIT_LOG_TOOL.input_schema.required).toContain("repo_dir");
    });

    it("has optional max_count number", () => {
      expect(GIT_LOG_TOOL.input_schema.properties.max_count.type).toBe("number");
      expect(GIT_LOG_TOOL.input_schema.required).not.toContain("max_count");
    });
  });

  describe("GIT_BRANCH_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_BRANCH_TOOL.name).toBe("git_branch");
    });

    it("requires repo_dir", () => {
      expect(GIT_BRANCH_TOOL.input_schema.required).toContain("repo_dir");
    });

    it("has optional name string", () => {
      expect(GIT_BRANCH_TOOL.input_schema.properties.name.type).toBe("string");
      expect(GIT_BRANCH_TOOL.input_schema.required).not.toContain("name");
    });
  });

  describe("GIT_CHECKOUT_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_CHECKOUT_TOOL.name).toBe("git_checkout");
    });

    it("requires repo_dir and branch", () => {
      expect(GIT_CHECKOUT_TOOL.input_schema.required).toContain("repo_dir");
      expect(GIT_CHECKOUT_TOOL.input_schema.required).toContain("branch");
    });

    it("has optional create boolean", () => {
      expect(GIT_CHECKOUT_TOOL.input_schema.properties.create.type).toBe("boolean");
      expect(GIT_CHECKOUT_TOOL.input_schema.required).not.toContain("create");
    });
  });

  describe("GIT_PUSH_TOOL", () => {
    it("has the correct name", () => {
      expect(GIT_PUSH_TOOL.name).toBe("git_push");
    });

    it("requires repo_dir", () => {
      expect(GIT_PUSH_TOOL.input_schema.required).toContain("repo_dir");
    });

    it("has optional remote string", () => {
      expect(GIT_PUSH_TOOL.input_schema.properties.remote.type).toBe("string");
      expect(GIT_PUSH_TOOL.input_schema.required).not.toContain("remote");
    });

    it("has optional branch string", () => {
      expect(GIT_PUSH_TOOL.input_schema.properties.branch.type).toBe("string");
      expect(GIT_PUSH_TOOL.input_schema.required).not.toContain("branch");
    });
  });
});

describe("Workspace Tool Definitions", () => {
  describe("RUN_TESTS_TOOL", () => {
    it("has the correct name", () => {
      expect(RUN_TESTS_TOOL.name).toBe("run_tests");
    });

    it("has a non-empty description", () => {
      expect(RUN_TESTS_TOOL.description.length).toBeGreaterThan(20);
    });

    it("requires repo_dir", () => {
      expect(RUN_TESTS_TOOL.input_schema.required).toContain("repo_dir");
    });

    it("has optional command string", () => {
      expect(RUN_TESTS_TOOL.input_schema.properties.command.type).toBe("string");
      expect(RUN_TESTS_TOOL.input_schema.required).not.toContain("command");
    });

    it("has optional timeout_ms number", () => {
      expect(RUN_TESTS_TOOL.input_schema.properties.timeout_ms.type).toBe("number");
      expect(RUN_TESTS_TOOL.input_schema.required).not.toContain("timeout_ms");
    });
  });
});

describe("GitHub Tool Definitions", () => {
  describe("CREATE_PR_TOOL", () => {
    it("has the correct name", () => {
      expect(CREATE_PR_TOOL.name).toBe("create_pr");
    });

    it("has a non-empty description", () => {
      expect(CREATE_PR_TOOL.description.length).toBeGreaterThan(20);
    });

    it("requires owner, repo, title, and head", () => {
      expect(CREATE_PR_TOOL.input_schema.required).toContain("owner");
      expect(CREATE_PR_TOOL.input_schema.required).toContain("repo");
      expect(CREATE_PR_TOOL.input_schema.required).toContain("title");
      expect(CREATE_PR_TOOL.input_schema.required).toContain("head");
    });

    it("has optional base string", () => {
      expect(CREATE_PR_TOOL.input_schema.properties.base.type).toBe("string");
      expect(CREATE_PR_TOOL.input_schema.required).not.toContain("base");
    });

    it("has optional body string", () => {
      expect(CREATE_PR_TOOL.input_schema.properties.body.type).toBe("string");
      expect(CREATE_PR_TOOL.input_schema.required).not.toContain("body");
    });
  });
});

describe("Browse Web Tool Definition", () => {
  describe("BROWSE_WEB_TOOL", () => {
    it("has the correct name", () => {
      expect(BROWSE_WEB_TOOL.name).toBe("browse_web");
    });

    it("has a non-empty description", () => {
      expect(BROWSE_WEB_TOOL.description.length).toBeGreaterThan(20);
    });

    it("requires url", () => {
      expect(BROWSE_WEB_TOOL.input_schema.required).toContain("url");
    });

    it("defines url as string", () => {
      expect(BROWSE_WEB_TOOL.input_schema.properties.url.type).toBe("string");
    });

    it("has optional max_length number", () => {
      expect(BROWSE_WEB_TOOL.input_schema.properties.max_length.type).toBe("number");
      expect(BROWSE_WEB_TOOL.input_schema.required).not.toContain("max_length");
    });
  });
});
