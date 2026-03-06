import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createLogger } from "@ai-cofounder/shared";
import type {
  ExecutionRequest,
  ExecutionResult,
  SandboxConfig,
  SandboxLanguage,
} from "./types.js";

const logger = createLogger("sandbox");

const DOCKER_IMAGES: Record<SandboxLanguage, string> = {
  typescript: "node:22-slim",
  javascript: "node:22-slim",
  python: "python:3.12-slim",
  bash: "alpine:3.20",
};

const LANGUAGE_COMMANDS: Record<SandboxLanguage, (code: string) => string[]> = {
  typescript: (code) => [
    "sh",
    "-c",
    `echo '${escapeShell(code)}' > /tmp/run.ts && npx --yes tsx /tmp/run.ts`,
  ],
  javascript: (code) => ["node", "-e", code],
  python: (code) => ["python3", "-c", code],
  bash: (code) => ["sh", "-c", code],
};

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex").slice(0, 16);
}

async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("docker", ["info"], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

export class SandboxService {
  private config: Required<SandboxConfig>;

  constructor(config?: SandboxConfig) {
    this.config = {
      memoryLimit: config?.memoryLimit ?? "256m",
      cpuLimit: config?.cpuLimit ?? "0.5",
      pidsLimit: config?.pidsLimit ?? "64",
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 30_000,
      dockerAvailable: config?.dockerAvailable ?? false,
    };
  }

  async init(): Promise<void> {
    this.config.dockerAvailable = await isDockerAvailable();
    if (this.config.dockerAvailable) {
      logger.info("Docker is available — sandbox execution enabled");
    } else {
      logger.warn("Docker is NOT available — sandbox execution disabled");
    }
  }

  get available(): boolean {
    return this.config.dockerAvailable;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.config.dockerAvailable) {
      return {
        stdout: "",
        stderr: "Sandbox execution is unavailable: Docker not found",
        exitCode: 1,
        durationMs: 0,
        language: request.language,
        timedOut: false,
      };
    }

    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs;
    const image = DOCKER_IMAGES[request.language];
    const cmd = LANGUAGE_COMMANDS[request.language](request.code);

    const containerName = `sandbox-${hashCode(request.code)}-${Date.now()}`;

    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--network=none",
      "--read-only",
      `--memory=${this.config.memoryLimit}`,
      `--cpus=${this.config.cpuLimit}`,
      `--pids-limit=${this.config.pidsLimit}`,
      // Writable /tmp for temp files
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      image,
      ...cmd,
    ];

    logger.info(
      {
        language: request.language,
        codeHash: hashCode(request.code),
        timeoutMs,
        taskId: request.taskId,
      },
      "executing code in sandbox",
    );

    const startTime = Date.now();

    return new Promise<ExecutionResult>((resolve) => {
      const proc = execFile(
        "docker",
        dockerArgs,
        {
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1MB output limit
          encoding: "utf-8",
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const timedOut = error?.killed === true;

          let exitCode = 0;
          if (error) {
            // Node wraps the exit code in error.code for non-zero exits
            exitCode =
              typeof (error as NodeJS.ErrnoException).code === "number"
                ? ((error as NodeJS.ErrnoException).code as unknown as number)
                : (error as unknown as { status?: number }).status ?? 1;
          }

          if (timedOut) {
            // Kill the container if it timed out (the process may be dead but container lingers)
            execFile("docker", ["kill", containerName], () => {
              // ignore errors — container may already be removed
            });
          }

          logger.info(
            {
              language: request.language,
              exitCode,
              durationMs,
              timedOut,
              stdoutLen: stdout.length,
              stderrLen: stderr.length,
            },
            "sandbox execution completed",
          );

          resolve({
            stdout: truncate(stdout, 10_000),
            stderr: truncate(stderr, 10_000),
            exitCode,
            durationMs,
            language: request.language,
            timedOut,
          });
        },
      );

      // Safety: if the process object doesn't exist, resolve immediately
      if (!proc) {
        resolve({
          stdout: "",
          stderr: "Failed to spawn Docker process",
          exitCode: 1,
          durationMs: 0,
          language: request.language,
          timedOut: false,
        });
      }
    });
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + `\n... (truncated, ${s.length} total chars)`;
}

export function createSandboxService(config?: SandboxConfig): SandboxService {
  return new SandboxService(config);
}
