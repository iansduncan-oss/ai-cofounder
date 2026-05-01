import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const execFileAsync = promisify(execFile);
const logger = createLogger("vps-command");

/** Allowlist: only these command prefixes are permitted on the VPS */
const ALLOWED_COMMANDS = [
  /^docker\s+(compose|logs|ps|inspect|stats|top|port)\b/,
  /^docker\s+compose\s+-f\s+[\w./-]+\s+(logs|ps|restart|up|down|pull|exec)\b/,
  /^cd\s+\/opt\/ai-cofounder\s+&&\s+docker\s+compose\b/,
  /^(cat|head|tail|less|grep|wc|du|df|free|uptime|top|htop|ps|lsof|ss|netstat|whoami|hostname|uname|date|journalctl)\b/,
  /^systemctl\s+(status|is-active|is-enabled|show|list-units)\b/,
  /^git\s+(log|status|diff|show|branch|rev-parse)\b/,
  /^ls\b/,
  /^find\s+\/opt\b/,
  /^curl\s+(--head|-I|--silent|-s)\b/,
  /^npm\s+(ls|list|outdated|audit)\b/,
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
    // Safety check: only allow known-safe command patterns
    const trimmedCmd = command.trim();
    const allowed = ALLOWED_COMMANDS.some((pattern) => pattern.test(trimmedCmd));
    if (!allowed) {
      logger.warn({ command: trimmedCmd.slice(0, 100) }, "blocked non-allowlisted VPS command");
      return {
        stdout: "",
        stderr: "Command blocked: not in the allowed commands list. Only diagnostic and Docker management commands are permitted.",
        exitCode: 1,
        durationMs: 0,
        blocked: true,
      };
    }

    const timeoutMs = Math.min((opts?.timeoutSeconds ?? 60) * 1000, 300_000);
    const sshArgs = [
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      "-o", "LogLevel=ERROR",
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
    // Sanitize inputs to prevent command injection
    const safeFile = composeFile.replace(/[^a-zA-Z0-9._-]/g, "");
    const safeService = service.replace(/[^a-zA-Z0-9._-]/g, "");
    return this.execute(
      `cd /opt/ai-cofounder && docker compose -f ${safeFile} restart ${safeService}`,
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
