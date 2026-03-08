import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { type NotificationService } from "./notifications.js";

const logger = createLogger("monitoring");

export interface MonitoringConfig {
  githubToken?: string;
  githubRepos?: string[]; // e.g. ["owner/repo"]
  vpsHost?: string;
  vpsUser?: string;
  notificationService: NotificationService;
}

export interface GitHubCIStatus {
  repo: string;
  branch: string;
  status: "success" | "failure" | "pending" | "error";
  conclusion: string | null;
  url: string;
  updatedAt: string;
}

export interface GitHubPR {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  createdAt: string;
  reviewDecision: string | null;
  isDraft: boolean;
}

export interface VPSHealthStatus {
  diskUsagePercent: number;
  memoryUsagePercent: number;
  cpuLoadAvg: number[];
  uptime: string;
  containers: ContainerStatus[];
}

export interface ContainerStatus {
  name: string;
  status: string;
  health: string;
  uptime: string;
}

export interface MonitoringReport {
  timestamp: string;
  github?: {
    ciStatus: GitHubCIStatus[];
    openPRs: GitHubPR[];
  };
  vps?: VPSHealthStatus;
  alerts: MonitoringAlert[];
}

export interface MonitoringAlert {
  severity: "critical" | "warning" | "info";
  source: string;
  message: string;
}

export class MonitoringService {
  private githubToken: string;
  private githubRepos: string[];
  private vpsHost: string;
  private vpsUser: string;
  private notificationService: NotificationService;
  private lastKnownState: Map<string, string> = new Map();

  constructor(config: MonitoringConfig) {
    this.githubToken = config.githubToken ?? "";
    this.githubRepos = config.githubRepos ?? [];
    this.vpsHost = config.vpsHost ?? "";
    this.vpsUser = config.vpsUser ?? "";
    this.notificationService = config.notificationService;
  }

  isGitHubConfigured(): boolean {
    return !!(this.githubToken && this.githubRepos.length > 0);
  }

  isVPSConfigured(): boolean {
    return !!(this.vpsHost && this.vpsUser);
  }

  // ── GitHub CI Status ──

  async checkGitHubCI(): Promise<GitHubCIStatus[]> {
    if (!this.isGitHubConfigured()) return [];

    const results: GitHubCIStatus[] = [];
    for (const repo of this.githubRepos) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/actions/runs?per_page=5&branch=main`,
          {
            headers: {
              Authorization: `Bearer ${this.githubToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (!res.ok) {
          logger.warn({ repo, status: res.status }, "GitHub API error");
          continue;
        }

        const data = (await res.json()) as {
          workflow_runs: Array<{
            head_branch: string;
            status: string;
            conclusion: string | null;
            html_url: string;
            updated_at: string;
          }>;
        };

        for (const run of data.workflow_runs.slice(0, 3)) {
          results.push({
            repo,
            branch: run.head_branch,
            status: run.status as GitHubCIStatus["status"],
            conclusion: run.conclusion,
            url: run.html_url,
            updatedAt: run.updated_at,
          });
        }
      } catch (err) {
        logger.error({ err, repo }, "Failed to check GitHub CI");
      }
    }

    return results;
  }

  // ── GitHub Open PRs ──

  async checkGitHubPRs(): Promise<GitHubPR[]> {
    if (!this.isGitHubConfigured()) return [];

    const results: GitHubPR[] = [];
    for (const repo of this.githubRepos) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/pulls?state=open&per_page=20`,
          {
            headers: {
              Authorization: `Bearer ${this.githubToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (!res.ok) continue;

        const data = (await res.json()) as Array<{
          number: number;
          title: string;
          user: { login: string };
          html_url: string;
          created_at: string;
          draft: boolean;
        }>;

        for (const pr of data) {
          results.push({
            repo,
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            url: pr.html_url,
            createdAt: pr.created_at,
            reviewDecision: null,
            isDraft: pr.draft,
          });
        }
      } catch (err) {
        logger.error({ err, repo }, "Failed to check GitHub PRs");
      }
    }

    return results;
  }

  // ── VPS Health ──

  async checkVPSHealth(): Promise<VPSHealthStatus | null> {
    if (!this.isVPSConfigured()) return null;

    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      // Run all checks in one SSH command using execFile (no shell injection)
      const script = [
        "df -h / | tail -1 | awk '{print $5}'",
        "free | grep Mem | awk '{printf \"%.1f\", $3/$2 * 100}'",
        "cat /proc/loadavg | awk '{print $1,$2,$3}'",
        "uptime -p",
        "docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null || echo 'no-docker'",
      ].join(" && echo '---SEPARATOR---' && ");

      const { stdout } = await execFileAsync(
        "ssh",
        [
          "-o", "ConnectTimeout=10",
          "-o", "StrictHostKeyChecking=no",
          `${this.vpsUser}@${this.vpsHost}`,
          script,
        ],
        { timeout: 15_000 },
      );

      const parts = stdout.split("---SEPARATOR---").map((s) => s.trim());

      const diskStr = parts[0]?.replace("%", "") ?? "0";
      const memStr = parts[1] ?? "0";
      const loadParts = (parts[2] ?? "0 0 0").split(" ").map(Number);
      const uptimeStr = parts[3] ?? "unknown";
      const containerLines = (parts[4] ?? "").split("\n").filter(Boolean);

      const containers: ContainerStatus[] = containerLines
        .filter((l) => l !== "no-docker")
        .map((line) => {
          const [name, status] = line.split("|");
          const isHealthy = status?.includes("(healthy)") ?? false;
          return {
            name: name ?? "unknown",
            status: status ?? "unknown",
            health: isHealthy ? "healthy" : status?.includes("(unhealthy)") ? "unhealthy" : "none",
            uptime: status ?? "",
          };
        });

      return {
        diskUsagePercent: parseFloat(diskStr),
        memoryUsagePercent: parseFloat(memStr),
        cpuLoadAvg: loadParts,
        uptime: uptimeStr,
        containers,
      };
    } catch (err) {
      logger.error({ err }, "Failed to check VPS health");
      return null;
    }
  }

  // ── Full monitoring run ──

  async runFullCheck(): Promise<MonitoringReport> {
    const [ciStatus, openPRs, vpsHealth] = await Promise.all([
      this.checkGitHubCI(),
      this.checkGitHubPRs(),
      this.checkVPSHealth(),
    ]);

    const alerts: MonitoringAlert[] = [];

    // Check for CI failures
    for (const ci of ciStatus) {
      if (ci.conclusion === "failure") {
        const stateKey = `ci-${ci.repo}-${ci.branch}`;
        if (this.lastKnownState.get(stateKey) !== "failure") {
          alerts.push({
            severity: "critical",
            source: "github-ci",
            message: `CI failed on ${ci.repo} (${ci.branch}): ${ci.url}`,
          });
          this.lastKnownState.set(stateKey, "failure");
        }
      } else if (ci.conclusion === "success") {
        const stateKey = `ci-${ci.repo}-${ci.branch}`;
        if (this.lastKnownState.get(stateKey) === "failure") {
          alerts.push({
            severity: "info",
            source: "github-ci",
            message: `CI recovered on ${ci.repo} (${ci.branch})`,
          });
        }
        this.lastKnownState.set(stateKey, "success");
      }
    }

    // Check for stale PRs
    const now = Date.now();
    for (const pr of openPRs) {
      const ageHours = (now - new Date(pr.createdAt).getTime()) / (1000 * 60 * 60);
      if (ageHours > 48 && !pr.isDraft) {
        alerts.push({
          severity: "warning",
          source: "github-prs",
          message: `PR #${pr.number} "${pr.title}" by ${pr.author} has been open ${Math.round(ageHours)}h`,
        });
      }
    }

    // Check VPS thresholds
    if (vpsHealth) {
      if (vpsHealth.diskUsagePercent > 90) {
        alerts.push({
          severity: "critical",
          source: "vps",
          message: `Disk usage at ${vpsHealth.diskUsagePercent}%`,
        });
      } else if (vpsHealth.diskUsagePercent > 75) {
        alerts.push({
          severity: "warning",
          source: "vps",
          message: `Disk usage at ${vpsHealth.diskUsagePercent}%`,
        });
      }

      if (vpsHealth.memoryUsagePercent > 90) {
        alerts.push({
          severity: "critical",
          source: "vps",
          message: `Memory usage at ${vpsHealth.memoryUsagePercent}%`,
        });
      }

      if (vpsHealth.cpuLoadAvg[0] !== undefined && vpsHealth.cpuLoadAvg[0] > 4) {
        alerts.push({
          severity: "warning",
          source: "vps",
          message: `High CPU load: ${vpsHealth.cpuLoadAvg.join(", ")}`,
        });
      }

      // Check for unhealthy containers
      for (const container of vpsHealth.containers) {
        if (container.health === "unhealthy") {
          alerts.push({
            severity: "critical",
            source: "vps",
            message: `Container ${container.name} is unhealthy`,
          });
        }
      }
    }

    const report: MonitoringReport = {
      timestamp: new Date().toISOString(),
      alerts,
    };

    if (this.isGitHubConfigured()) {
      report.github = { ciStatus, openPRs };
    }
    if (vpsHealth) {
      report.vps = vpsHealth;
    }

    // Send critical/warning alerts
    const criticalAlerts = alerts.filter((a) => a.severity === "critical");
    const warningAlerts = alerts.filter((a) => a.severity === "warning");

    if (criticalAlerts.length > 0) {
      const msg = criticalAlerts.map((a) => `[CRITICAL] ${a.message}`).join("\n");
      await this.notificationService.sendBriefing(`**CRITICAL ALERTS**\n${msg}`);
    } else if (warningAlerts.length > 0) {
      const msg = warningAlerts.map((a) => `[WARNING] ${a.message}`).join("\n");
      await this.notificationService.sendBriefing(`**Warnings**\n${msg}`);
    }

    logger.info(
      {
        ciChecks: ciStatus.length,
        openPRs: openPRs.length,
        vpsChecked: !!vpsHealth,
        alertCount: alerts.length,
      },
      "Monitoring check complete",
    );

    return report;
  }
}

export function createMonitoringService(
  notificationService: NotificationService,
): MonitoringService {
  const githubToken = optionalEnv("GITHUB_TOKEN", "");
  const reposStr = optionalEnv("GITHUB_MONITORED_REPOS", "");
  const githubRepos = reposStr ? reposStr.split(",").map((r) => r.trim()) : [];

  return new MonitoringService({
    githubToken,
    githubRepos,
    vpsHost: optionalEnv("VPS_HOST", ""),
    vpsUser: optionalEnv("VPS_USER", ""),
    notificationService,
  });
}
