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

/** Validate dependency names to prevent shell injection via crafted package names */
const SAFE_DEP_PATTERN = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[a-z0-9._^~>=<|-]+)?$/i;

function sanitizeDeps(deps: string[] | undefined): string[] {
  if (!deps?.length) return [];
  return deps.filter((d) => SAFE_DEP_PATTERN.test(d));
}

const LANGUAGE_COMMANDS: Record<SandboxLanguage, (code: string, deps?: string[]) => string[]> = {
  typescript: (code, deps) => {
    const safeDeps = sanitizeDeps(deps);
    const install = safeDeps.length ? `npm install --no-save ${safeDeps.join(" ")} && ` : "";
    return [
      "sh",
      "-c",
      `${install}echo '${escapeShell(code)}' > /tmp/run.ts && npx --yes tsx /tmp/run.ts`,
    ];
  },
  javascript: (code, deps) => {
    const safeDeps = sanitizeDeps(deps);
    if (safeDeps.length) {
      return ["sh", "-c", `npm install --no-save ${safeDeps.join(" ")} && node -e ${JSON.stringify(code)}`];
    }
    return ["node", "-e", code];
  },
  python: (code, deps) => {
    const safeDeps = sanitizeDeps(deps);
    if (safeDeps.length) {
      return ["sh", "-c", `pip install --quiet ${safeDeps.join(" ")} && python3 -c ${JSON.stringify(code)}`];
    }
    return ["python3", "-c", code];
  },
  bash: (code) => ["sh", "-c", code],
};

interface CacheEntry {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cachedAt: number;
}

const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  private cache = new Map<string, CacheEntry>();

  constructor(config?: SandboxConfig) {
    this.config = {
      memoryLimit: config?.memoryLimit ?? "256m",
      cpuLimit: config?.cpuLimit ?? "0.5",
      pidsLimit: config?.pidsLimit ?? "64",
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 30_000,
      dockerAvailable: config?.dockerAvailable ?? false,
    };
  }

  private cacheKey(request: ExecutionRequest): string {
    const deps = request.dependencies?.sort().join(",") ?? "";
    return createHash("sha256")
      .update(`${request.language}:${request.code}:${deps}`)
      .digest("hex");
  }

  private getCached(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  private putCache(key: string, entry: CacheEntry): void {
    // Evict oldest if at capacity
    if (this.cache.size >= CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, entry);
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

  /**
   * Finds and removes orphaned sandbox containers that have been running
   * longer than the default timeout + a buffer. Returns number cleaned.
   */
  async cleanupOrphanContainers(): Promise<number> {
    if (!this.config.dockerAvailable) return 0;

    const maxAgeMs = this.config.defaultTimeoutMs + 30_000; // timeout + 30s buffer

    return new Promise<number>((resolve) => {
      // List running containers with our managed label, get ID + creation time
      execFile(
        "docker",
        [
          "ps",
          "--filter", "label=ai-cofounder.managed=true",
          "--format", "{{.ID}}\t{{.CreatedAt}}",
          "--no-trunc",
        ],
        { timeout: 10_000, encoding: "utf-8" },
        async (err, stdout) => {
          if (err || !stdout.trim()) {
            resolve(0);
            return;
          }

          const lines = stdout.trim().split("\n").filter(Boolean);
          let cleaned = 0;

          for (const line of lines) {
            const [id, ...createdParts] = line.split("\t");
            if (!id || !createdParts.length) continue;

            const createdAt = new Date(createdParts.join("\t")).getTime();
            if (Number.isNaN(createdAt)) continue;

            const ageMs = Date.now() - createdAt;
            if (ageMs > maxAgeMs) {
              await new Promise<void>((res) => {
                execFile("docker", ["rm", "-f", id], { timeout: 10_000 }, () => res());
              });
              logger.warn({ containerId: id, ageMs }, "removed orphaned sandbox container");
              cleaned++;
            }
          }

          if (cleaned > 0) {
            logger.info({ cleaned }, "orphaned sandbox container cleanup complete");
          }
          resolve(cleaned);
        },
      );
    });
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
        oomKilled: false,
      };
    }

    // Check cache
    const cacheKey = this.cacheKey(request);
    const cached = this.getCached(cacheKey);
    if (cached) {
      logger.info({ language: request.language, cacheKey: cacheKey.slice(0, 12) }, "sandbox cache hit");
      return {
        stdout: cached.stdout,
        stderr: cached.stderr,
        exitCode: cached.exitCode,
        durationMs: cached.durationMs,
        language: request.language,
        timedOut: false,
        oomKilled: false,
        cached: true,
      };
    }

    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs;
    const image = DOCKER_IMAGES[request.language];
    const cmd = LANGUAGE_COMMANDS[request.language](request.code, request.dependencies);

    const containerName = `sandbox-${hashCode(request.code)}-${Date.now()}`;

    const hasDeps = request.dependencies && request.dependencies.length > 0;
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      // Labels for identification and cleanup
      "--label", "ai-cofounder.managed=true",
      "--label", `ai-cofounder.language=${request.language}`,
      "--label", `ai-cofounder.task-id=${request.taskId ?? ""}`,
      // Allow network only when dependencies need installing
      ...(hasDeps ? [] : ["--network=none"]),
      ...(hasDeps ? [] : ["--read-only"]),
      `--memory=${this.config.memoryLimit}`,
      `--cpus=${this.config.cpuLimit}`,
      `--pids-limit=${this.config.pidsLimit}`,
      // Writable /tmp for temp files
      "--tmpfs",
      "/tmp:rw,nosuid,size=128m",
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

          // OOM kill: Docker sends SIGKILL (exit 137) when memory limit exceeded
          const oomKilled = exitCode === 137 && !timedOut;

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
              oomKilled,
              stdoutLen: stdout.length,
              stderrLen: stderr.length,
            },
            "sandbox execution completed",
          );

          const result: ExecutionResult = {
            stdout: truncate(stdout, 10_000),
            stderr: oomKilled
              ? truncate(`OOM: Container killed — exceeded ${this.config.memoryLimit} memory limit.\n${stderr}`, 10_000)
              : truncate(stderr, 10_000),
            exitCode,
            durationMs,
            language: request.language,
            timedOut,
            oomKilled,
            cached: false,
          };

          // Cache successful, non-timed-out results
          if (exitCode === 0 && !timedOut) {
            this.putCache(cacheKey, {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode,
              durationMs,
              cachedAt: Date.now(),
            });
          }

          resolve(result);
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
          oomKilled: false,
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
