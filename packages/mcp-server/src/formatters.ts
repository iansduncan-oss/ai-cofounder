import type {
  DashboardSummary,
  ProviderHealth,
  Goal,
  Approval,
  Conversation,
  PipelineRun,
  Memory,
  BriefingResponse,
  QueueStatus,
  MonitoringReport,
  PaginatedResponse,
  SubagentRun,
  BudgetStatusResponse,
  StandupResponse,
  GoalAnalytics,
  FollowUp,
  GlobalSearchResults,
  Task,
  ToolStat,
  Deployment,
  DeployCircuitBreakerStatus,
  GoalCostSummary,
  JournalEntry,
  Reflection,
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

export function formatGoal(data: Goal): string {
  const lines: string[] = [`# ${data.title}`, ""];
  lines.push(`- **ID**: ${data.id}`);
  lines.push(`- **Status**: ${data.status}`);
  lines.push(`- **Priority**: ${data.priority}`);
  if (data.scope) lines.push(`- **Scope**: ${data.scope}`);
  lines.push(`- **Conversation**: ${data.conversationId}`);
  if (data.description) lines.push(`- **Description**: ${data.description}`);
  if (data.createdBy) lines.push(`- **Created By**: ${data.createdBy}`);
  lines.push(`- **Created**: ${data.createdAt}`);
  lines.push(`- **Updated**: ${data.updatedAt}`);
  return lines.join("\n");
}

export function formatApprovals(data: Approval[]): string {
  if (data.length === 0) return "No pending approvals.";

  const lines: string[] = [`# Pending Approvals (${data.length})`, ""];
  for (const a of data) {
    lines.push(`- **${a.id}** — Task: ${a.taskId}`);
    lines.push(`  Requested by: ${a.requestedBy} | Reason: ${a.reason}`);
  }
  return lines.join("\n");
}

export function formatBudgetStatus(data: BudgetStatusResponse): string {
  const lines: string[] = ["# Budget Status", ""];
  lines.push("## Daily");
  lines.push(`- Spent: $${data.daily.spentUsd.toFixed(4)}`);
  lines.push(`- Limit: $${data.daily.limitUsd.toFixed(4)}`);
  lines.push(`- Used: ${data.daily.percentUsed != null ? `${data.daily.percentUsed.toFixed(1)}%` : "N/A"}`);
  lines.push("");
  lines.push("## Weekly");
  lines.push(`- Spent: $${data.weekly.spentUsd.toFixed(4)}`);
  lines.push(`- Limit: $${data.weekly.limitUsd.toFixed(4)}`);
  lines.push(`- Used: ${data.weekly.percentUsed != null ? `${data.weekly.percentUsed.toFixed(1)}%` : "N/A"}`);
  if (data.optimizationSuggestions.length > 0) {
    lines.push("");
    lines.push("## Suggestions");
    for (const s of data.optimizationSuggestions) {
      lines.push(`- ${s}`);
    }
  }
  return lines.join("\n");
}

export function formatErrorSummary(
  data: { timestamp: string; hours: number; totalErrors: number; errors: Array<{ toolName: string; errorMessage: string | null; count: number; lastSeen: string }> },
): string {
  if (data.totalErrors === 0) return `No errors in the past ${data.hours} hours.`;

  const lines: string[] = [`# Error Summary (${data.totalErrors} errors in past ${data.hours}h)`, ""];
  for (const e of data.errors) {
    lines.push(`- **${e.toolName}** (x${e.count}) — ${e.errorMessage ?? "unknown error"}`);
    lines.push(`  Last seen: ${e.lastSeen}`);
  }
  return lines.join("\n");
}

export function formatStandup(data: StandupResponse): string {
  const lines: string[] = [`# Standup — ${data.date}`, ""];
  lines.push(data.narrative);
  lines.push("");
  lines.push("## Metrics");
  lines.push(`- Total entries: ${data.data.totalEntries}`);
  lines.push(`- Cost: $${data.data.costUsd.toFixed(4)}`);
  if (data.data.highlights.length > 0) {
    lines.push("");
    lines.push("## Highlights");
    for (const h of data.data.highlights) {
      lines.push(`- ${h}`);
    }
  }
  return lines.join("\n");
}

export function formatConversations(data: PaginatedResponse<Conversation>): string {
  if (data.data.length === 0) return "No conversations found.";

  const lines: string[] = [`# Conversations (${data.data.length} of ${data.total})`, ""];
  for (const c of data.data) {
    lines.push(`- **${c.title ?? "Untitled"}** (${c.id})`);
    lines.push(`  Created: ${c.createdAt}`);
  }
  return lines.join("\n");
}

export function formatSearchResults(data: GlobalSearchResults): string {
  const total = data.goals.length + data.tasks.length + data.conversations.length + data.memories.length;
  if (total === 0) return "No search results found.";

  const lines: string[] = [`# Search Results (${total})`, ""];
  if (data.goals.length > 0) {
    lines.push(`## Goals (${data.goals.length})`);
    for (const g of data.goals) {
      lines.push(`- **${g.title}** [${g.status}] (${g.id})`);
    }
    lines.push("");
  }
  if (data.tasks.length > 0) {
    lines.push(`## Tasks (${data.tasks.length})`);
    for (const t of data.tasks) {
      lines.push(`- **${t.title}** [${t.status}] (${t.id})`);
    }
    lines.push("");
  }
  if (data.conversations.length > 0) {
    lines.push(`## Conversations (${data.conversations.length})`);
    for (const c of data.conversations) {
      lines.push(`- **${c.title ?? "Untitled"}** (${c.id})`);
    }
    lines.push("");
  }
  if (data.memories.length > 0) {
    lines.push(`## Memories (${data.memories.length})`);
    for (const m of data.memories) {
      lines.push(`- [${m.category}/${m.key}] ${m.content}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function formatFollowUps(data: { data: FollowUp[]; total: number }): string {
  if (data.data.length === 0) return "No follow-ups found.";

  const lines: string[] = [`# Follow-Ups (${data.data.length} of ${data.total})`, ""];
  for (const f of data.data) {
    const due = f.dueDate ? ` — due ${f.dueDate}` : "";
    lines.push(`- [${f.status}] **${f.title}**${due} (${f.id})`);
    if (f.description) lines.push(`  ${f.description}`);
  }
  return lines.join("\n");
}

export function formatGoalAnalytics(data: GoalAnalytics): string {
  const lines: string[] = ["# Goal Analytics", ""];
  lines.push("## Summary");
  lines.push(`- Total Goals: ${data.totalGoals}`);
  lines.push(`- Completion Rate: ${data.completionRate.toFixed(1)}%`);
  if (data.avgCompletionHours != null) lines.push(`- Avg Completion: ${data.avgCompletionHours.toFixed(1)}h`);
  lines.push(`- Task Success Rate: ${data.taskSuccessRate.toFixed(1)}%`);
  lines.push(`- Total Tasks: ${data.totalTasks}`);
  lines.push("");
  lines.push("## By Status");
  for (const [status, count] of Object.entries(data.byStatus)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push("");
  lines.push("## By Priority");
  for (const [priority, count] of Object.entries(data.byPriority)) {
    lines.push(`- ${priority}: ${count}`);
  }
  if (data.tasksByAgent.length > 0) {
    lines.push("");
    lines.push("## By Agent");
    for (const a of data.tasksByAgent) {
      lines.push(`- **${a.agent}**: ${a.completed}/${a.total} completed, ${a.failed} failed`);
    }
  }
  return lines.join("\n");
}

export function formatTasks(data: PaginatedResponse<Task>): string {
  if (data.data.length === 0) return "No tasks found.";
  const lines: string[] = [`# Tasks (${data.data.length} of ${data.total})`, ""];
  for (const t of data.data) {
    lines.push(`- **${t.title}** [${t.status}] agent: ${t.assignedAgent ?? "unassigned"} (${t.id})`);
    if (t.error) lines.push(`  Error: ${t.error}`);
  }
  return lines.join("\n");
}

export function formatGoalCost(data: GoalCostSummary): string {
  const lines: string[] = ["# Goal Cost", ""];
  lines.push(`- Total Cost: $${data.totalCostUsd.toFixed(4)}`);
  lines.push(`- Input Tokens: ${data.totalInputTokens.toLocaleString()}`);
  lines.push(`- Output Tokens: ${data.totalOutputTokens.toLocaleString()}`);
  lines.push(`- Requests: ${data.requestCount}`);
  return lines.join("\n");
}

export function formatN8nWorkflows(data: Array<{ id: string; name: string; description?: string; webhookUrl: string; isActive: boolean; direction: string }>): string {
  if (data.length === 0) return "No n8n workflows found.";
  const lines: string[] = [`# n8n Workflows (${data.length})`, ""];
  for (const w of data) {
    lines.push(`- ${w.isActive ? "\u2705" : "\u23f8"} **${w.name}** [${w.direction}] (${w.id})`);
    if (w.description) lines.push(`  ${w.description}`);
  }
  return lines.join("\n");
}

export function formatDeployments(data: { data: Deployment[]; total: number }): string {
  if (data.data.length === 0) return "No deployments found.";
  const lines: string[] = [`# Deployments (${data.data.length} of ${data.total})`, ""];
  for (const d of data.data) {
    lines.push(`- **${d.shortSha}** [${d.status}] ${d.branch} — by ${d.triggeredBy}`);
    if (d.errorLog) lines.push(`  Error: ${d.errorLog}`);
  }
  return lines.join("\n");
}

export function formatCircuitBreaker(data: DeployCircuitBreakerStatus): string {
  const lines: string[] = ["# Deploy Circuit Breaker", ""];
  lines.push(`- Status: ${data.isPaused ? "PAUSED" : "Active"}`);
  lines.push(`- Failures: ${data.failureCount}`);
  if (data.pausedAt) lines.push(`- Paused At: ${data.pausedAt}`);
  if (data.pausedReason) lines.push(`- Reason: ${data.pausedReason}`);
  if (data.resumedAt) lines.push(`- Resumed At: ${data.resumedAt}`);
  return lines.join("\n");
}

export function formatToolStats(data: { timestamp: string; tools: ToolStat[] }): string {
  if (data.tools.length === 0) return "No tool stats available.";
  const lines: string[] = [`# Tool Stats (${data.tools.length} tools)`, ""];
  for (const t of data.tools) {
    const rate = t.totalExecutions > 0 ? ((t.successCount / t.totalExecutions) * 100).toFixed(1) : "N/A";
    lines.push(`- **${t.toolName}**: ${rate}% success, ${t.avgDurationMs.toFixed(0)}ms avg, ${t.totalExecutions} calls`);
  }
  return lines.join("\n");
}

export function formatReflections(data: { data: Reflection[]; total: number }): string {
  if (data.data.length === 0) return "No reflections found.";
  const lines: string[] = [`# Reflections (${data.data.length} of ${data.total})`, ""];
  for (const r of data.data) {
    lines.push(`- [${r.reflectionType}] ${r.content.slice(0, 120)}${r.content.length > 120 ? "..." : ""}`);
    if (r.lessons && r.lessons.length > 0) {
      for (const l of r.lessons.slice(0, 2)) {
        lines.push(`  Lesson: ${l.lesson}`);
      }
    }
  }
  return lines.join("\n");
}

export function formatJournalEntries(data: { data: JournalEntry[]; total: number }): string {
  if (data.data.length === 0) return "No journal entries found.";
  const lines: string[] = [`# Journal (${data.data.length} of ${data.total})`, ""];
  for (const j of data.data) {
    lines.push(`- [${j.entryType}] **${j.title}** — ${j.occurredAt}`);
    if (j.summary) lines.push(`  ${j.summary}`);
  }
  return lines.join("\n");
}
