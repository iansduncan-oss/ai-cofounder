import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { WorkspaceService } = await import("../services/workspace.js");

let testDir: string;
let workspace: InstanceType<typeof WorkspaceService>;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
  workspace = new WorkspaceService(testDir);
  await workspace.init();
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("WorkspaceService", () => {
  describe("resolveSafe", () => {
    it("resolves a valid relative path within workspace", () => {
      const resolved = workspace.resolveSafe("src/index.ts");
      expect(resolved).toBe(path.join(testDir, "src/index.ts"));
    });

    it("resolves the workspace root itself", () => {
      const resolved = workspace.resolveSafe(".");
      expect(resolved).toBe(testDir);
    });

    it("rejects path traversal with ..", () => {
      expect(() => workspace.resolveSafe("../../../etc/passwd")).toThrow("Path traversal denied");
    });

    it("rejects path traversal with encoded sequences", () => {
      expect(() => workspace.resolveSafe("foo/../../..")).toThrow("Path traversal denied");
    });

    it("rejects absolute paths outside workspace", () => {
      expect(() => workspace.resolveSafe("/etc/passwd")).toThrow("Path traversal denied");
    });
  });

  describe("file operations", () => {
    it("writes and reads a file", async () => {
      await workspace.writeFile("hello.txt", "Hello, World!");
      const content = await workspace.readFile("hello.txt");
      expect(content).toBe("Hello, World!");
    });

    it("creates nested directories when writing", async () => {
      await workspace.writeFile("a/b/c/deep.txt", "deep content");
      const content = await workspace.readFile("a/b/c/deep.txt");
      expect(content).toBe("deep content");
    });

    it("throws on reading a non-existent file", async () => {
      await expect(workspace.readFile("nope.txt")).rejects.toThrow();
    });

    it("rejects path traversal on read", async () => {
      await expect(workspace.readFile("../../etc/passwd")).rejects.toThrow("Path traversal denied");
    });

    it("rejects path traversal on write", async () => {
      await expect(workspace.writeFile("../../evil.txt", "bad")).rejects.toThrow("Path traversal denied");
    });
  });

  describe("listDirectory", () => {
    it("lists files and directories", async () => {
      await workspace.writeFile("file1.txt", "a");
      await workspace.writeFile("dir1/file2.txt", "b");

      const entries = await workspace.listDirectory(".");
      const names = entries.map((e) => e.name);
      expect(names).toContain("file1.txt");
      expect(names).toContain("dir1");

      const file1 = entries.find((e) => e.name === "file1.txt");
      expect(file1?.type).toBe("file");

      const dir1 = entries.find((e) => e.name === "dir1");
      expect(dir1?.type).toBe("directory");
    });

    it("lists root when called with no args", async () => {
      await workspace.writeFile("root.txt", "content");
      const entries = await workspace.listDirectory();
      expect(entries.some((e) => e.name === "root.txt")).toBe(true);
    });

    it("rejects path traversal on list", async () => {
      await expect(workspace.listDirectory("../..")).rejects.toThrow("Path traversal denied");
    });

    it("throws on non-existent directory", async () => {
      await expect(workspace.listDirectory("doesntexist")).rejects.toThrow();
    });
  });

  describe("git branch operations", () => {
    let repoDir: string;

    beforeEach(async () => {
      // Create a git repo with an initial commit using execFile (safe, no user input)
      repoDir = path.join(testDir, "test-repo");
      await fs.mkdir(repoDir, { recursive: true });
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["init"], { cwd: repoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      await fs.writeFile(path.join(repoDir, "README.md"), "# Test");
      execFileSync("git", ["add", "."], { cwd: repoDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });
    });

    it("lists branches", async () => {
      const result = await workspace.gitBranch("test-repo");
      expect(result.exitCode).toBe(0);
      // Default branch could be main or master
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("creates a new branch", async () => {
      const result = await workspace.gitBranch("test-repo", "feature-x");
      expect(result.exitCode).toBe(0);

      const listResult = await workspace.gitBranch("test-repo");
      expect(listResult.stdout).toContain("feature-x");
    });

    it("checks out an existing branch", async () => {
      await workspace.gitBranch("test-repo", "dev");
      const result = await workspace.gitCheckout("test-repo", "dev");
      expect(result.exitCode).toBe(0);
    });

    it("creates and checks out a new branch with create flag", async () => {
      const result = await workspace.gitCheckout("test-repo", "new-feature", true);
      expect(result.exitCode).toBe(0);

      const branches = await workspace.gitBranch("test-repo");
      expect(branches.stdout).toContain("new-feature");
    });

    it("fails to checkout non-existent branch without create flag", async () => {
      const result = await workspace.gitCheckout("test-repo", "does-not-exist");
      expect(result.exitCode).not.toBe(0);
    });

    it("fails to push without a remote", async () => {
      const result = await workspace.gitPush("test-repo");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("runTests", () => {
    it("runs a successful command", async () => {
      const result = await workspace.runTests(".", "echo 'hello tests'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello tests");
    });

    it("captures failure exit code", async () => {
      const result = await workspace.runTests(".", "exit 1");
      expect(result.exitCode).not.toBe(0);
    });

    it("respects path traversal protection", async () => {
      await expect(
        workspace.runTests("../../outside", "echo pwned"),
      ).rejects.toThrow("Path traversal denied");
    });
  });
});
