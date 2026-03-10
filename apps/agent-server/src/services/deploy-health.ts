import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { updateDeploymentStatus } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { NotificationService } from "./notifications.js";
import type { MonitoringService } from "./monitoring.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const logger = createLogger("deploy-health");

export interface HealthCheckResult {
  service: string;
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs?: number;
  error?: string;
}

export class DeployHealthService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private notificationService: NotificationService,
    private monitoringService?: MonitoringService,
  ) {}

  async verifyDeployment(
    deploymentId: string,
    commitSha: string,
    previousSha?: string,
  ): Promise<void> {
    const checks: HealthCheckResult[] = [];

    // Check agent-server health endpoint
    const agentCheck = await this.checkAgentServerHealth();
    checks.push(agentCheck);

    // Check VPS containers via monitoring service
    if (this.monitoringService) {
      try {
        const vpsHealth = await this.monitoringService.checkVPSHealth();
        if (vpsHealth) {
          for (const c of vpsHealth.containers ?? []) {
            checks.push({
              service: c.name,
              status: c.health === "healthy" || c.status.includes("Up") ? "healthy" : "unhealthy",
            });
          }
        }
      } catch (err) {
        logger.warn({ err }, "VPS container check failed");
        checks.push({ service: "vps-containers", status: "unknown", error: String(err) });
      }
    }

    const allHealthy = checks.every((c) => c.status === "healthy");

    if (allHealthy) {
      await updateDeploymentStatus(this.db, deploymentId, {
        status: "healthy",
        healthChecks: checks,
        completedAt: new Date(),
      });
      logger.info({ deploymentId, commitSha: commitSha.slice(0, 7) }, "deploy verified healthy");

      await this.notificationService.sendBriefing(
        `✅ Deploy \`${commitSha.slice(0, 7)}\` verified healthy. All services passing health checks.`,
      ).catch(() => {});
    } else {
      logger.warn({ deploymentId, checks }, "deploy health check failed");
      await this.handleDeployFailure(deploymentId, commitSha, previousSha, checks);
    }
  }

  async handleDeployFailure(
    deploymentId: string,
    commitSha: string,
    previousSha?: string,
    checks?: HealthCheckResult[],
  ): Promise<void> {
    const containerLogs = await this.fetchContainerLogs();
    const errorSummary = checks
      ?.filter((c) => c.status !== "healthy")
      .map((c) => `${c.service}: ${c.error ?? c.status}`)
      .join("; ") ?? "Unknown failure";

    // LLM root cause analysis
    const rootCause = await this.analyzeRootCause(commitSha, errorSummary, containerLogs);

    // Attempt rollback if previous SHA available
    let rolledBack = false;
    let rollbackSha: string | undefined;
    if (previousSha) {
      try {
        await this.executeRollback(previousSha);
        rolledBack = true;
        rollbackSha = previousSha;
        logger.info({ deploymentId, previousSha: previousSha.slice(0, 7) }, "rollback executed");
      } catch (err) {
        logger.error({ err, deploymentId }, "rollback failed");
      }
    }

    await updateDeploymentStatus(this.db, deploymentId, {
      status: rolledBack ? "rolled_back" : "failed",
      healthChecks: checks,
      errorLog: containerLogs,
      rootCauseAnalysis: rootCause,
      rolledBack,
      rollbackSha,
      completedAt: new Date(),
    });

    // Send notification
    const statusEmoji = rolledBack ? "🔄" : "❌";
    const message = [
      `${statusEmoji} Deploy \`${commitSha.slice(0, 7)}\` failed.`,
      rolledBack ? `Rolled back to \`${previousSha?.slice(0, 7)}\`.` : "No previous version available for rollback.",
      "",
      "**Root Cause Analysis:**",
      rootCause,
    ].join("\n");

    await this.notificationService.sendBriefing(message).catch(() => {});
  }

  async analyzeRootCause(
    commitSha: string,
    errorSummary: string,
    containerLogs: string,
  ): Promise<string> {
    try {
      const prompt = [
        "You are a DevOps engineer analyzing a failed deployment.",
        `Commit: ${commitSha.slice(0, 7)}`,
        `Error: ${errorSummary}`,
        "",
        "Container logs (last 100 lines):",
        containerLogs.slice(0, 3000),
        "",
        "Provide a concise root cause diagnosis (2-3 sentences) and a recommended fix (1-2 sentences).",
      ].join("\n");

      const result = await this.llmRegistry.complete("simple", {
        system: "You are a concise DevOps diagnostic assistant.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      });

      const text = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      return text || "Unable to determine root cause.";
    } catch (err) {
      logger.warn({ err }, "root cause analysis failed");
      return `Analysis failed: ${errorSummary}`;
    }
  }

  async executeRollback(previousSha: string): Promise<void> {
    const vpsHost = optionalEnv("VPS_HOST", "");
    const vpsUser = optionalEnv("VPS_USER", "ian");
    if (!vpsHost) throw new Error("VPS_HOST not configured");

    const rollbackScript = [
      `sudo docker tag ai-cofounder-agent-server:${previousSha} ai-cofounder-agent-server:latest`,
      `sudo docker tag ai-cofounder-discord-bot:${previousSha} ai-cofounder-discord-bot:latest`,
      `sudo docker tag ai-cofounder-slack-bot:${previousSha} ai-cofounder-slack-bot:latest`,
      `cd /opt/ai-cofounder && sudo docker compose -f docker-compose.prod.yml up -d --force-recreate`,
    ].join(" && ");

    await execFileAsync("ssh", [
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=30",
      `${vpsUser}@${vpsHost}`,
      rollbackScript,
    ], { timeout: 120_000 });
  }

  async fetchContainerLogs(): Promise<string> {
    const vpsHost = optionalEnv("VPS_HOST", "");
    const vpsUser = optionalEnv("VPS_USER", "ian");
    if (!vpsHost) return "VPS_HOST not configured — cannot fetch logs";

    try {
      const { stdout } = await execFileAsync("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        `${vpsUser}@${vpsHost}`,
        "sudo docker logs --tail 100 ai-cofounder-agent-server 2>&1 || echo 'No logs available'",
      ], { timeout: 30_000 });
      return stdout;
    } catch (err) {
      logger.warn({ err }, "failed to fetch container logs");
      return `Log fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async checkAgentServerHealth(): Promise<HealthCheckResult> {
    const healthUrl = optionalEnv("DEPLOY_HEALTH_URL", "http://localhost:3100/health");
    const start = Date.now();
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { service: "agent-server", status: "healthy", latencyMs };
      }
      return { service: "agent-server", status: "unhealthy", latencyMs, error: `HTTP ${res.status}` };
    } catch (err) {
      return {
        service: "agent-server",
        status: "unhealthy",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
