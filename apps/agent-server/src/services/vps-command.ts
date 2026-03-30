import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const execFileAsync = promisify(execFile);
const logger = createLogger("vps-command");

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\/(?!\w)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bsystemctl\s+(stop|disable)\s+(docker|sshd?)\b/i,
  /\bufw\s+(disable|reset)\b/i,
  /\biptables\s+-F\b/i,
  /\b(passwd|usermod|userdel)\b/i,
  /\bchmod\s+777\s+\//i,
];

export interface VpsCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  blocked?: boolean;
}

export class VpsCommandService {
  constructor(
    private host: string,
    private user: string,
    private sshKeyPath?: string,
  ) {}

  async execute(command: string, opts?: { timeoutSeconds?: number }): Promise<VpsCommandResult> {
    // Safety check
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        logger.warn({ command: command.slice(0, 100) }, "blocked dangerous VPS command");
        return {
          stdout: "",
          stderr: `Command blocked: matches safety rule ${pattern}`,
          exitCode: 1,
          durationMs: 0,
          blocked: true,
        };
      }
    }

    const timeoutMs = Math.min((opts?.timeoutSeconds ?? 60) * 1000, 300_000);
    const sshArgs = [
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      ...(this.sshKeyPath ? ["-i", this.sshKeyPath] : []),
      `${this.user}@${this.host}`,
      command,
    ];

    const start = Date.now();
    logger.info({ command: command.slice(0, 200), host: this.host }, "executing VPS command");

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
      });
      const durationMs = Date.now() - start;
      logger.info({ durationMs, exitCode: 0, command: command.slice(0, 100) }, "VPS command completed");
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0, durationMs };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
      const exitCode = typeof e.code === "number" ? e.code : 1;
      const timedOut = e.killed || (typeof e.code === "string" && e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      logger.warn({ durationMs, exitCode, timedOut, command: command.slice(0, 100) }, "VPS command failed");
      return {
        stdout: (e.stdout ?? "").trim(),
        stderr: timedOut ? `Command timed out after ${timeoutMs / 1000}s` : (e.stderr ?? "").trim(),
        exitCode,
        durationMs,
      };
    }
  }

  /** Convenience: get Docker compose service logs */
  async getServiceLogs(service: string, lines = 50): Promise<string> {
    const result = await this.execute(
      `cd /opt/ai-cofounder && docker compose -f docker-compose.prod.yml logs --tail=${lines} ${service} 2>&1`,
      { timeoutSeconds: 30 },
    );
    return result.stdout || result.stderr;
  }

  /** Convenience: restart a Docker compose service */
  async restartService(service: string, composeFile = "docker-compose.prod.yml"): Promise<VpsCommandResult> {
    return this.execute(
      `cd /opt/ai-cofounder && docker compose -f ${composeFile} restart ${service}`,
      { timeoutSeconds: 120 },
    );
  }
}

export function createVpsCommandService(): VpsCommandService | undefined {
  const host = optionalEnv("VPS_HOST", "");
  const user = optionalEnv("VPS_USER", "");
  if (!host || !user) {
    logger.warn("VPS_HOST or VPS_USER not set — VPS command tools disabled");
    return undefined;
  }
  const sshKeyPath = optionalEnv("SSH_KEY_PATH", "");
  logger.info({ host, user }, "VPS command service initialized");
  return new VpsCommandService(host, user, sshKeyPath || undefined);
}
