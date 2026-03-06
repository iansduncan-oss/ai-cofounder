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
});
