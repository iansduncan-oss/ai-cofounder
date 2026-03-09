import type {
  DashboardSummary,
  ProviderHealth,
  Goal,
  PipelineRun,
  Memory,
  BriefingResponse,
  QueueStatus,
  MonitoringReport,
  PaginatedResponse,
  SubagentRun,
} from "@ai-cofounder/api-client";

export function formatDashboard(data: DashboardSummary): string {
  const lines: string[] = ["# Dashboard Summary", ""];

  lines.push(`## Goals: ${data.goals.activeCount} active`);
  if (data.goals.recent.length > 0) {
    for (const g of data.goals.recent) {
      lines.push(`- ${g.title} [${g.status}] (${g.completedTaskCount}/${g.taskCount} tasks)`);
    }
  }
  lines.push("");

  lines.push("## Tasks");
  lines.push(`- Pending: ${data.tasks.pendingCount}`);
  lines.push(`- Running: ${data.tasks.runningCount}`);
  lines.push(`- Completed: ${data.tasks.completedCount}`);
  lines.push(`- Failed: ${data.tasks.failedCount}`);
  lines.push("");

  lines.push("## Costs");
  lines.push(`- Today: $${data.costs.today.toFixed(4)}`);
  lines.push(`- Week: $${data.costs.week.toFixed(4)}`);
  lines.push(`- Month: $${data.costs.month.toFixed(4)}`);
  lines.push("");

  return lines.join("\n");
}

export function formatMonitoring(data: MonitoringReport): string {
  const lines: string[] = ["# Monitoring Report", ""];

  if (data.github) {
    lines.push("## GitHub CI");
    for (const ci of data.github.ciStatus) {
      lines.push(`- ${ci.repo}/${ci.branch}: ${ci.status}${ci.conclusion ? ` (${ci.conclusion})` : ""}`);
    }
    lines.push("");

    lines.push("## Open PRs");
    for (const pr of data.github.openPRs) {
      lines.push(`- #${pr.number} ${pr.title} by ${pr.author}`);
    }
    lines.push("");
  }

  if (data.vps) {
    lines.push("## VPS Health");
    lines.push(`- CPU Load: ${data.vps.cpuLoadAvg.join(", ")}`);
    lines.push(`- Memory: ${data.vps.memoryUsagePercent.toFixed(1)}%`);
    lines.push(`- Disk: ${data.vps.diskUsagePercent.toFixed(1)}%`);
    lines.push(`- Uptime: ${data.vps.uptime}`);
    lines.push("");

    lines.push("### Containers");
    for (const c of data.vps.containers) {
      lines.push(`- ${c.name}: ${c.status}${c.health ? ` (${c.health})` : ""}`);
    }
    lines.push("");
  }

  if (data.alerts.length > 0) {
    lines.push("## Alerts");
    for (const alert of data.alerts) {
      lines.push(`- [${alert.severity}] ${alert.source}: ${alert.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatQueues(data: { queues: QueueStatus[] }): string {
  const lines: string[] = ["# Queue Status", ""];
  for (const q of data.queues) {
    lines.push(`## ${q.name}`);
    lines.push(`- Waiting: ${q.waiting}`);
    lines.push(`- Active: ${q.active}`);
    lines.push(`- Completed: ${q.completed}`);
    lines.push(`- Failed: ${q.failed}`);
    lines.push(`- Delayed: ${q.delayed}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatGoals(data: PaginatedResponse<Goal>): string {
  if (data.data.length === 0) return "No goals found.";

  const lines: string[] = [`# Goals (${data.data.length} of ${data.total})`, ""];
  for (const g of data.data) {
    lines.push(`- **${g.title}** [${g.status}/${g.priority}] (${g.id})`);
    if (g.description) lines.push(`  ${g.description}`);
  }
  return lines.join("\n");
}

export function formatBriefing(data: BriefingResponse): string {
  if (!data.briefing) return "No briefing available.";
  return `# Daily Briefing\n\n${data.briefing}`;
}

export function formatPipelines(data: { runs: PipelineRun[] }): string {
  if (data.runs.length === 0) return "No pipeline runs found.";

  const lines: string[] = [`# Pipelines (${data.runs.length})`, ""];
  for (const r of data.runs) {
    lines.push(`- **${r.pipelineId}** [${r.state}] ${r.stageCount} stages (job: ${r.jobId})`);
    if (r.failedReason) lines.push(`  Error: ${r.failedReason}`);
  }
  return lines.join("\n");
}

export function formatMemories(data: PaginatedResponse<Memory>): string {
  if (data.data.length === 0) return "No memories found.";

  const lines: string[] = [`# Memories (${data.data.length} of ${data.total})`, ""];
  for (const m of data.data) {
    lines.push(`- [${m.category}/${m.key}] ${m.content} (importance: ${m.importance})`);
  }
  return lines.join("\n");
}

export function formatSubagentRun(run: SubagentRun): string {
  const lines: string[] = [`# Subagent: ${run.title}`, ""];
  lines.push(`- **ID**: ${run.id}`);
  lines.push(`- **Status**: ${run.status}`);
  lines.push(`- **Instruction**: ${run.instruction}`);
  if (run.model) lines.push(`- **Model**: ${run.model} (${run.provider ?? "unknown"})`);
  if (run.toolRounds > 0) lines.push(`- **Tool Rounds**: ${run.toolRounds}`);
  if (run.toolsUsed && run.toolsUsed.length > 0) lines.push(`- **Tools Used**: ${run.toolsUsed.join(", ")}`);
  if (run.tokens > 0) lines.push(`- **Tokens**: ${run.tokens}`);
  if (run.durationMs != null) lines.push(`- **Duration**: ${(run.durationMs / 1000).toFixed(1)}s`);
  if (run.output) lines.push(`\n## Output\n\n${run.output}`);
  if (run.error) lines.push(`\n## Error\n\n${run.error}`);
  return lines.join("\n");
}

export function formatSubagentRuns(data: { data: SubagentRun[]; total: number }): string {
  if (data.data.length === 0) return "No subagent runs found.";

  const lines: string[] = [`# Subagent Runs (${data.data.length} of ${data.total})`, ""];
  for (const r of data.data) {
    const duration = r.durationMs != null ? ` ${(r.durationMs / 1000).toFixed(1)}s` : "";
    lines.push(`- **${r.title}** [${r.status}]${duration} (${r.id})`);
  }
  return lines.join("\n");
}

export function formatProviderHealth(
  data: { status: string; timestamp: string; providers: ProviderHealth[] },
): string {
  const lines: string[] = ["# LLM Provider Health", ""];
  for (const p of data.providers) {
    const successRate = p.totalRequests > 0
      ? ((p.successCount / p.totalRequests) * 100).toFixed(1)
      : "N/A";
    lines.push(`## ${p.provider} ${p.available ? "(available)" : "(unavailable)"}`);
    lines.push(`- Requests: ${p.totalRequests}`);
    lines.push(`- Success Rate: ${successRate}%`);
    lines.push(`- Avg Latency: ${p.avgLatencyMs.toFixed(0)}ms`);
    if (p.recentErrors.length > 0) {
      lines.push(`- Recent Errors: ${p.recentErrors.length}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
