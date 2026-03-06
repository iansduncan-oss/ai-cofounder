import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("workspace");

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class WorkspaceService {
  readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? optionalEnv("WORKSPACE_DIR", "/tmp/ai-cofounder-workspace");
  }

  /** Ensure the workspace root directory exists */
  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    logger.info({ rootDir: this.rootDir }, "workspace initialized");
  }

  /**
   * Resolve a relative path within the workspace, preventing path traversal.
   * Throws if the resolved path escapes the workspace root.
   */
  resolveSafe(relativePath: string): string {
    const resolved = path.resolve(this.rootDir, relativePath);
    if (!resolved.startsWith(this.rootDir + path.sep) && resolved !== this.rootDir) {
      throw new Error(`Path traversal denied: ${relativePath}`);
    }
    return resolved;
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = this.resolveSafe(relativePath);
    return fs.readFile(fullPath, "utf-8");
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolveSafe(relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async listDirectory(relativePath: string = "."): Promise<FileEntry[]> {
    const fullPath = this.resolveSafe(relativePath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" as const : "file" as const,
    }));
  }

  /** Run a git command in a specific directory within the workspace */
  private async runGit(args: string[], cwd: string): Promise<GitResult> {
    const safeCwd = this.resolveSafe(path.relative(this.rootDir, cwd));
    return new Promise((resolve) => {
      execFile("git", args, { cwd: safeCwd, timeout: 60_000 }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error?.code ? (typeof error.code === "number" ? error.code : 1) : 0,
        });
      });
    });
  }

  async gitClone(repoUrl: string, dirName?: string): Promise<GitResult> {
    const targetName = dirName ?? this.repoNameFromUrl(repoUrl);
    const targetPath = this.resolveSafe(targetName);

    // Check if target already exists
    try {
      await fs.access(targetPath);
      return { stdout: "", stderr: `Directory already exists: ${targetName}`, exitCode: 1 };
    } catch {
      // Directory doesn't exist, proceed with clone
    }

    return new Promise((resolve) => {
      execFile(
        "git",
        ["clone", "--depth", "1", repoUrl, targetPath],
        { cwd: this.rootDir, timeout: 120_000 },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            exitCode: error?.code ? (typeof error.code === "number" ? error.code : 1) : 0,
          });
        },
      );
    });
  }

  async gitStatus(repoDir: string): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    return this.runGit(["status", "--short"], fullPath);
  }

  async gitDiff(repoDir: string, staged?: boolean): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    const args = staged ? ["diff", "--staged"] : ["diff"];
    return this.runGit(args, fullPath);
  }

  async gitAdd(repoDir: string, paths: string[]): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    return this.runGit(["add", ...paths], fullPath);
  }

  async gitCommit(repoDir: string, message: string): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    return this.runGit(["commit", "-m", message], fullPath);
  }

  async gitPull(repoDir: string, remote: string = "origin", branch?: string): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    const args = branch ? ["pull", remote, branch] : ["pull", remote];
    return this.runGit(args, fullPath);
  }

  async gitLog(repoDir: string, maxCount: number = 10): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    return this.runGit(["log", "--oneline", `-${maxCount}`], fullPath);
  }

  async gitBranch(repoDir: string, name?: string): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    const args = name ? ["branch", name] : ["branch", "-a"];
    return this.runGit(args, fullPath);
  }

  async gitCheckout(repoDir: string, branch: string, create?: boolean): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    const args = create ? ["checkout", "-b", branch] : ["checkout", branch];
    return this.runGit(args, fullPath);
  }

  async gitPush(repoDir: string, remote: string = "origin", branch?: string): Promise<GitResult> {
    const fullPath = this.resolveSafe(repoDir);
    const args = branch ? ["push", remote, branch] : ["push", remote];
    return this.runGit(args, fullPath);
  }

  async runTests(repoDir: string, command: string = "npm test", timeoutMs: number = 300_000): Promise<GitResult> {
    const safeCwd = this.resolveSafe(repoDir);
    const cappedTimeout = Math.min(timeoutMs, 300_000);
    return new Promise((resolve) => {
      execFile("sh", ["-c", command], { cwd: safeCwd, timeout: cappedTimeout }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error?.code ? (typeof error.code === "number" ? error.code : 1) : 0,
        });
      });
    });
  }

  private repoNameFromUrl(url: string): string {
    const parts = url.replace(/\.git$/, "").split("/");
    return parts[parts.length - 1] || "repo";
  }
}

export function createWorkspaceService(rootDir?: string): WorkspaceService {
  return new WorkspaceService(rootDir);
}
