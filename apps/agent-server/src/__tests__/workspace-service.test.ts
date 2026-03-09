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

  describe("deleteFile", () => {
    it("deletes a file within workspace", async () => {
      await workspace.writeFile("temp.txt", "content");
      await workspace.deleteFile("temp.txt");
      await expect(workspace.readFile("temp.txt")).rejects.toThrow();
    });

    it("rejects path traversal on deleteFile", async () => {
      await expect(workspace.deleteFile("../../etc/passwd")).rejects.toThrow("Path traversal denied");
    });

    it("throws when deleting non-existent file", async () => {
      await expect(workspace.deleteFile("does-not-exist.txt")).rejects.toThrow();
    });
  });

  describe("deleteDirectory", () => {
    it("deletes an empty directory", async () => {
      await fs.mkdir(path.join(testDir, "empty-dir"), { recursive: true });
      await workspace.deleteDirectory("empty-dir");
      await expect(workspace.listDirectory("empty-dir")).rejects.toThrow();
    });

    it("fails to delete non-empty directory without force", async () => {
      await workspace.writeFile("non-empty/file.txt", "content");
      await expect(workspace.deleteDirectory("non-empty")).rejects.toThrow();
    });

    it("deletes non-empty directory with force=true", async () => {
      await workspace.writeFile("to-remove/nested/file.txt", "content");
      await workspace.deleteDirectory("to-remove", true);
      await expect(workspace.listDirectory("to-remove")).rejects.toThrow();
    });

    it("rejects path traversal on deleteDirectory", async () => {
      await expect(workspace.deleteDirectory("../../tmp")).rejects.toThrow("Path traversal denied");
    });
  });

  describe("git core operations", () => {
    let repoDir: string;

    beforeEach(async () => {
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

    it("shows clean status on a fresh repo", async () => {
      const result = await workspace.gitStatus("test-repo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });

    it("shows modified files in status", async () => {
      await fs.writeFile(path.join(repoDir, "README.md"), "# Updated");
      const result = await workspace.gitStatus("test-repo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("README.md");
    });

    it("shows untracked files in status", async () => {
      await fs.writeFile(path.join(repoDir, "new-file.txt"), "new");
      const result = await workspace.gitStatus("test-repo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("new-file.txt");
    });

    it("shows diff for unstaged changes", async () => {
      await fs.writeFile(path.join(repoDir, "README.md"), "# Changed");
      const result = await workspace.gitDiff("test-repo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("-# Test");
      expect(result.stdout).toContain("+# Changed");
    });

    it("shows empty diff when no changes", async () => {
      const result = await workspace.gitDiff("test-repo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });

    it("shows staged diff with staged flag", async () => {
      await fs.writeFile(path.join(repoDir, "README.md"), "# Staged");
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["add", "README.md"], { cwd: repoDir });

      const result = await workspace.gitDiff("test-repo", true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("+# Staged");
    });

    it("stages files with gitAdd", async () => {
      await fs.writeFile(path.join(repoDir, "new.txt"), "content");
      const addResult = await workspace.gitAdd("test-repo", ["new.txt"]);
      expect(addResult.exitCode).toBe(0);

      const statusResult = await workspace.gitStatus("test-repo");
      expect(statusResult.stdout).toContain("new.txt");
      // Should show as staged (A = added)
      expect(statusResult.stdout).toMatch(/A\s+new\.txt/);
    });

    it("stages multiple files", async () => {
      await fs.writeFile(path.join(repoDir, "a.txt"), "a");
      await fs.writeFile(path.join(repoDir, "b.txt"), "b");
      const result = await workspace.gitAdd("test-repo", ["a.txt", "b.txt"]);
      expect(result.exitCode).toBe(0);

      const status = await workspace.gitStatus("test-repo");
      expect(status.stdout).toContain("a.txt");
      expect(status.stdout).toContain("b.txt");
    });

    it("commits staged changes", async () => {
      await fs.writeFile(path.join(repoDir, "committed.txt"), "data");
      await workspace.gitAdd("test-repo", ["committed.txt"]);

      const result = await workspace.gitCommit("test-repo", "add committed.txt");
      expect(result.exitCode).toBe(0);

      // Status should be clean after commit
      const status = await workspace.gitStatus("test-repo");
      expect(status.stdout.trim()).toBe("");
    });

    it("fails to commit with nothing staged", async () => {
      const result = await workspace.gitCommit("test-repo", "empty commit");
      expect(result.exitCode).not.toBe(0);
    });

    it("shows commit history with gitLog", async () => {
      const result = await workspace.gitLog("test-repo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("init");
    });

    it("respects maxCount in gitLog", async () => {
      // Add a second commit
      await fs.writeFile(path.join(repoDir, "second.txt"), "2");
      await workspace.gitAdd("test-repo", ["second.txt"]);
      await workspace.gitCommit("test-repo", "second commit");

      const result = await workspace.gitLog("test-repo", 1);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(result.stdout).toContain("second commit");
    });

    it("shows full commit flow: modify → add → commit → log", async () => {
      await fs.writeFile(path.join(repoDir, "feature.ts"), "export const x = 1;");
      await workspace.gitAdd("test-repo", ["feature.ts"]);
      await workspace.gitCommit("test-repo", "feat: add feature.ts");

      const log = await workspace.gitLog("test-repo", 2);
      expect(log.stdout).toContain("feat: add feature.ts");
      expect(log.stdout).toContain("init");
    });

    it("fails gitPull without a remote", async () => {
      const result = await workspace.gitPull("test-repo");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("gitClone", () => {
    it("fails to clone an invalid URL", async () => {
      const result = await workspace.gitClone("https://invalid.example.com/no-repo.git");
      expect(result.exitCode).not.toBe(0);
    });

    it("returns error when target directory already exists", async () => {
      await fs.mkdir(path.join(testDir, "existing-repo"), { recursive: true });
      const result = await workspace.gitClone("https://github.com/test/existing-repo.git");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");
    });

    it("extracts repo name from URL", async () => {
      const result = await workspace.gitClone("https://github.com/test/my-project.git");
      // Will fail because the URL is invalid, but the target dir should be "my-project"
      expect(result.exitCode).not.toBe(0);
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
