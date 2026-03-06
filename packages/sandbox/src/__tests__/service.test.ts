import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxService, hashCode, createSandboxService } from "../service.js";

// Mock child_process.execFile (execFile is safe - no shell injection risk)
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

describe("SandboxService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("init()", () => {
    it("sets dockerAvailable=true when docker info succeeds", async () => {
      mockExecFile.mockImplementation(((
        cmd: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cmd === "docker" && args[0] === "info") {
          cb(null, "Docker info output", "");
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      const service = new SandboxService();
      await service.init();
      expect(service.available).toBe(true);
    });

    it("sets dockerAvailable=false when docker info fails", async () => {
      mockExecFile.mockImplementation(((
        cmd: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cmd === "docker" && args[0] === "info") {
          cb(new Error("Docker not found"), "", "");
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      const service = new SandboxService();
      await service.init();
      expect(service.available).toBe(false);
    });
  });

  describe("execute()", () => {
    it("returns error when docker is not available", async () => {
      const service = new SandboxService({ dockerAvailable: false });
      const result = await service.execute({
        code: "console.log('hi')",
        language: "javascript",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Docker not found");
      expect(result.durationMs).toBe(0);
    });

    it("executes JavaScript code with security flags", async () => {
      const service = new SandboxService({ dockerAvailable: true });

      mockExecFile.mockImplementation(((
        cmd: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cmd === "docker" && args[0] === "run") {
          expect(args).toContain("--network=none");
          expect(args).toContain("--read-only");
          expect(args).toContain("--rm");
          expect(args.some((a: string) => a.startsWith("--memory="))).toBe(true);
          expect(args.some((a: string) => a.startsWith("--cpus="))).toBe(true);
          expect(args.some((a: string) => a.startsWith("--pids-limit="))).toBe(true);
          cb(null, "hello world\n", "");
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      const result = await service.execute({
        code: "console.log('hello world')",
        language: "javascript",
      });

      expect(result.stdout).toBe("hello world\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.language).toBe("javascript");
    });

    it("handles execution timeout", async () => {
      const service = new SandboxService({ dockerAvailable: true });

      mockExecFile.mockImplementation(((...fnArgs: unknown[]) => {
        const cmd = fnArgs[0] as string;
        const args = fnArgs[1] as string[];
        // Callback can be 3rd or 4th arg depending on whether options object is passed
        const cb = (typeof fnArgs[3] === "function" ? fnArgs[3] : fnArgs[2]) as
          | ((err: Error | null, stdout: string, stderr: string) => void)
          | undefined;
        if (cmd === "docker" && args[0] === "run" && cb) {
          const error = new Error("timeout") as NodeJS.ErrnoException & { killed: boolean };
          error.killed = true;
          cb(error, "", "");
        }
        // docker kill calls don't need a response for this test
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      const result = await service.execute({
        code: "while(true){}",
        language: "javascript",
        timeoutMs: 1000,
      });

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    it("handles non-zero exit code", async () => {
      const service = new SandboxService({ dockerAvailable: true });

      mockExecFile.mockImplementation(((
        cmd: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cmd === "docker" && args[0] === "run") {
          const error = new Error("exit 1") as NodeJS.ErrnoException & { status: number };
          error.status = 1;
          cb(error, "", "SyntaxError: unexpected token\n");
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      const result = await service.execute({
        code: "invalid code!@#$",
        language: "javascript",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("SyntaxError");
    });

    it("uses correct Docker image for each language", async () => {
      const service = new SandboxService({ dockerAvailable: true });
      const capturedImages: string[] = [];

      mockExecFile.mockImplementation(((
        cmd: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cmd === "docker" && args[0] === "run") {
          const tmpfsIdx = args.indexOf("--tmpfs");
          const imageIdx = tmpfsIdx + 2;
          capturedImages.push(args[imageIdx] as string);
          cb(null, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      await service.execute({ code: "x", language: "javascript" });
      await service.execute({ code: "x", language: "typescript" });
      await service.execute({ code: "x", language: "python" });
      await service.execute({ code: "x", language: "bash" });

      expect(capturedImages).toEqual([
        "node:22-slim",
        "node:22-slim",
        "python:3.12-slim",
        "alpine:3.20",
      ]);
    });

    it("respects custom resource limits", async () => {
      const service = new SandboxService({
        dockerAvailable: true,
        memoryLimit: "512m",
        cpuLimit: "1.0",
        pidsLimit: "128",
      });

      mockExecFile.mockImplementation(((
        cmd: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cmd === "docker" && args[0] === "run") {
          expect(args).toContain("--memory=512m");
          expect(args).toContain("--cpus=1.0");
          expect(args).toContain("--pids-limit=128");
          cb(null, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      await service.execute({ code: "echo hi", language: "bash" });
    });
  });

  describe("hashCode()", () => {
    it("returns consistent hash for same input", () => {
      const hash1 = hashCode("console.log('hello')");
      const hash2 = hashCode("console.log('hello')");
      expect(hash1).toBe(hash2);
    });

    it("returns different hash for different input", () => {
      const hash1 = hashCode("code A");
      const hash2 = hashCode("code B");
      expect(hash1).not.toBe(hash2);
    });

    it("returns 16-char hex string", () => {
      const hash = hashCode("test");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("createSandboxService()", () => {
    it("creates a service with defaults", () => {
      const svc = createSandboxService();
      expect(svc).toBeInstanceOf(SandboxService);
      expect(svc.available).toBe(false);
    });
  });
});
