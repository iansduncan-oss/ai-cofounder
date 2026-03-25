import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { updateDeploymentStatus, updateDeploymentSoakStatus } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { NotificationService } from "./notifications.js";
import type { MonitoringService } from "./monitoring.js";
import type { DeployCircuitBreakerService } from "./deploy-circuit-breaker.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const logger = createLogger("deploy-health");

const CONTAINERS = ["ai-cofounder-agent-server", "ai-cofounder-discord-bot", "ai-cofounder-slack-bot"];

export interface HealthCheckResult {
  service: string;
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs?: number;
  error?: string;
}

export interface SoakMetric {
  checkAt: string;
  latencyMs: number;
  containerRestarts: number;
  healthy: boolean;
}

export interface RemediationAction {
  action: string;
  result: "success" | "failed";
  timestamp: string;
  detail?: string;
}

export class DeployHealthService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private notificationService: NotificationService,
    private monitoringService?: MonitoringService,
    private circuitBreakerService?: DeployCircuitBreakerService,
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

    // Fetch git diff for RCA context
    const gitDiff = previousSha ? await this.fetchGitDiffStat(previousSha, commitSha) : undefined;
    if (gitDiff) {
      await updateDeploymentSoakStatus(this.db, deploymentId, { gitDiffSummary: gitDiff });
    }

    // LLM root cause analysis (now includes git diff context)
    const rootCause = await this.analyzeRootCause(commitSha, errorSummary, containerLogs, gitDiff);

    // Try remediation before rollback
    const remediationSuccess = await this.tryRemediation(deploymentId);

    if (remediationSuccess) {
      // Re-verify after remediation
      const recheck = await this.checkAgentServerHealth();
      if (recheck.status === "healthy") {
        await updateDeploymentStatus(this.db, deploymentId, {
          status: "healthy",
          healthChecks: [recheck],
          rootCauseAnalysis: rootCause,
          completedAt: new Date(),
        });
        logger.info({ deploymentId }, "deploy recovered after remediation");
        await this.notificationService.sendBriefing(
          `🔧 Deploy \`${commitSha.slice(0, 7)}\` recovered after remediation.`,
        ).catch(() => {});
        return;
      }
    }

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

    // Record failure in circuit breaker
    if (this.circuitBreakerService) {
      await this.circuitBreakerService.recordFailure(commitSha, errorSummary).catch((err) => {
        logger.warn({ err }, "circuit breaker recordFailure failed");
      });
    }

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

  /**
   * Soak monitoring — runs health checks over a period to detect degradation
   * after initial verification passes.
   */
  async startSoakMonitoring(
    deploymentId: string,
    commitSha: string,
    previousSha?: string,
    durationMin = 10,
  ): Promise<void> {
    const checkCount = Math.min(5, Math.max(3, Math.floor(durationMin / 2)));
    const intervalMs = (durationMin * 60 * 1000) / checkCount;
    const metrics: SoakMetric[] = [];

    await updateDeploymentSoakStatus(this.db, deploymentId, {
      soakStatus: "monitoring",
      soakStartedAt: new Date(),
    });

    logger.info({ deploymentId, checkCount, intervalMs }, "starting soak monitoring");

    for (let i = 0; i < checkCount; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      const check = await this.checkAgentServerHealth();
      const restarts = await this.getContainerRestartCount();

      metrics.push({
        checkAt: new Date().toISOString(),
        latencyMs: check.latencyMs ?? 0,
        containerRestarts: restarts,
        healthy: check.status === "healthy",
      });

      // Update metrics in DB as we go
      await updateDeploymentSoakStatus(this.db, deploymentId, { soakMetrics: metrics });
    }

    const failedChecks = metrics.filter((m) => !m.healthy);
    const hasElevatedRestarts = metrics.some((m) => m.containerRestarts > 0);
    const avgLatency = metrics.reduce((sum, m) => sum + m.latencyMs, 0) / metrics.length;
    const hasHighLatency = avgLatency > 5000; // 5s threshold

    let soakStatus: string;
    if (failedChecks.length === 0 && !hasElevatedRestarts && !hasHighLatency) {
      soakStatus = "passed";
    } else if (failedChecks.length > metrics.length / 2) {
      soakStatus = "failed";
    } else {
      soakStatus = "degraded";
    }

    await updateDeploymentSoakStatus(this.db, deploymentId, {
      soakStatus,
      soakCompletedAt: new Date(),
      soakMetrics: metrics,
    });

    logger.info({ deploymentId, soakStatus, avgLatency, failedChecks: failedChecks.length }, "soak monitoring complete");

    if (soakStatus === "failed") {
      await this.handleDeployFailure(deploymentId, commitSha, previousSha);
    } else if (soakStatus === "degraded") {
      await this.notificationService.sendBriefing(
        `⚠️ Deploy \`${commitSha.slice(0, 7)}\` soak test shows degradation: ${failedChecks.length} failed checks, avg latency ${Math.round(avgLatency)}ms${hasElevatedRestarts ? ", container restarts detected" : ""}.`,
      ).catch(() => {});
    }
  }

  /**
   * Execute a remediation action (restart container or clear Redis cache).
   * Returns true if remediation was attempted.
   */
  async executeRemediation(
    action: "restart_containers" | "clear_cache",
    deploymentId?: string,
  ): Promise<RemediationAction> {
    const vpsHost = optionalEnv("VPS_HOST", "");
    const vpsUser = optionalEnv("VPS_USER", "ian");
    const now = new Date().toISOString();

    if (!vpsHost) {
      return { action, result: "failed", timestamp: now, detail: "VPS_HOST not configured" };
    }

    let command: string;
    if (action === "restart_containers") {
      command = "cd /opt/ai-cofounder && sudo docker compose -f docker-compose.prod.yml restart";
    } else {
      command = "sudo docker exec ai-cofounder-redis redis-cli FLUSHDB";
    }

    try {
      await execFileAsync("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=30",
        `${vpsUser}@${vpsHost}`,
        command,
      ], { timeout: 120_000 });

      const result: RemediationAction = { action, result: "success", timestamp: now };
      if (deploymentId) {
        await updateDeploymentSoakStatus(this.db, deploymentId, {
          remediationActions: [result],
        });
      }
      logger.info({ action }, "remediation action succeeded");
      return result;
    } catch (err) {
      const result: RemediationAction = {
        action,
        result: "failed",
        timestamp: now,
        detail: err instanceof Error ? err.message : String(err),
      };
      if (deploymentId) {
        await updateDeploymentSoakStatus(this.db, deploymentId, {
          remediationActions: [result],
        });
      }
      logger.warn({ err, action }, "remediation action failed");
      return result;
    }
  }

  async analyzeRootCause(
    commitSha: string,
    errorSummary: string,
    containerLogs: string,
    gitDiff?: string,
  ): Promise<string> {
    try {
      const promptParts = [
        "You are a DevOps engineer analyzing a failed deployment.",
        `Commit: ${commitSha.slice(0, 7)}`,
        `Error: ${errorSummary}`,
        "",
        "Container logs (last 100 lines per service):",
        containerLogs.slice(0, 4000),
      ];

      if (gitDiff) {
        promptParts.push("", "Git diff summary:", gitDiff.slice(0, 1000));
      }

      promptParts.push("", "Provide a concise root cause diagnosis (2-3 sentences) and a recommended fix (1-2 sentences).");

      const result = await this.llmRegistry.complete("simple", {
        system: "You are a concise DevOps diagnostic assistant.",
        messages: [{ role: "user", content: promptParts.join("\n") }],
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

  /**
   * Fetch logs from all 3 containers (agent-server, discord-bot, slack-bot).
   */
  async fetchContainerLogs(): Promise<string> {
    const vpsHost = optionalEnv("VPS_HOST", "");
    const vpsUser = optionalEnv("VPS_USER", "ian");
    if (!vpsHost) return "VPS_HOST not configured — cannot fetch logs";

    const logSections: string[] = [];

    for (const container of CONTAINERS) {
      try {
        const { stdout } = await execFileAsync("ssh", [
          "-o", "StrictHostKeyChecking=accept-new",
          "-o", "ConnectTimeout=10",
          `${vpsUser}@${vpsHost}`,
          `sudo docker logs --tail 100 ${container} 2>&1 || echo 'No logs available'`,
        ], { timeout: 30_000 });
        logSections.push(`=== ${container} ===\n${stdout}`);
      } catch (err) {
        logSections.push(`=== ${container} ===\nLog fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return logSections.join("\n\n");
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

  private async getContainerRestartCount(): Promise<number> {
    const vpsHost = optionalEnv("VPS_HOST", "");
    const vpsUser = optionalEnv("VPS_USER", "ian");
    if (!vpsHost) return 0;

    try {
      const { stdout } = await execFileAsync("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        `${vpsUser}@${vpsHost}`,
        `sudo docker inspect --format '{{.RestartCount}}' ${CONTAINERS[0]} 2>/dev/null || echo '0'`,
      ], { timeout: 15_000 });
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private async fetchGitDiffStat(previousSha: string, commitSha: string): Promise<string | undefined> {
    const vpsHost = optionalEnv("VPS_HOST", "");
    const vpsUser = optionalEnv("VPS_USER", "ian");
    if (!vpsHost) return undefined;

    try {
      const { stdout } = await execFileAsync("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        `${vpsUser}@${vpsHost}`,
        `cd /opt/ai-cofounder && git diff --stat ${previousSha}..${commitSha} 2>/dev/null || echo 'Git diff unavailable'`,
      ], { timeout: 15_000 });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Try remediation (restart containers) before rollback.
   * Returns true if remediation was attempted.
   */
  private async tryRemediation(deploymentId: string): Promise<boolean> {
    try {
      const result = await this.executeRemediation("restart_containers", deploymentId);
      if (result.result === "success") {
        // Wait a few seconds for containers to come back up
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
