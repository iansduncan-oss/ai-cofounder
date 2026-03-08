import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listRecentWorkSessions,
  countTasksByStatus,
  createWorkSession,
  completeWorkSession,
  getTodayTokenTotal,
} from "@ai-cofounder/db";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { WorkspaceService } from "./services/workspace.js";
import { Orchestrator } from "./agents/orchestrator.js";

const logger = createLogger("autonomous-session");

export interface SessionOptions {
  /** Max session duration in ms (default: env SESSION_TIME_BUDGET_MS or 900_000 = 15min) */
  timeBudgetMs?: number;
  /** Max tokens to use (default: env SESSION_TOKEN_BUDGET or 50_000) */
  tokenBudget?: number;
  /** Trigger source (e.g. "schedule", "event", "manual") */
  trigger: string;
  /** Optional schedule ID that triggered this session */
  scheduleId?: string;
  /** Optional event ID that triggered this session */
  eventId?: string;
  /** Optional override prompt (e.g. from a schedule's actionPrompt) */
  prompt?: string;
  /** Discord webhook URL to report progress */
  webhookUrl?: string;
}

export interface SessionResult {
  sessionId: string;
  status: "completed" | "failed" | "timeout";
  summary: string;
  tokensUsed: number;
  durationMs: number;
}

async function sendWebhook(
  webhookUrl: string,
  payload: { content?: string; embeds?: object[] },
): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "webhook returned non-OK status");
    }
  } catch (err) {
    logger.warn({ err }, "failed to send Discord webhook");
  }
}

async function buildContextPrompt(db: Db, overridePrompt?: string): Promise<string> {
  const [activeGoals, recentSessions, taskCounts] = await Promise.all([
    listActiveGoals(db),
    listRecentWorkSessions(db, 5),
    countTasksByStatus(db),
  ]);

  const lines: string[] = [];
  lines.push("You are running in an autonomous work session. Analyze the current state and decide what to work on next.");
  lines.push("");

  if (overridePrompt) {
    lines.push(`**Scheduled directive:** ${overridePrompt}`);
    lines.push("");
  }

  if (activeGoals.length > 0) {
    lines.push("**Active goals:**");
    for (const g of activeGoals.slice(0, 10)) {
      const progress = g.taskCount > 0 ? `${g.completedTaskCount}/${g.taskCount} tasks done` : "no tasks yet";
      lines.push(`- "${g.title}" (${g.priority}, ${progress})`);
    }
  } else {
    lines.push("No active goals at the moment.");
  }

  lines.push("");
  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + b, 0);
  if (totalTasks > 0) {
    lines.push(
      `**Task breakdown:** ${totalTasks} total — ` +
        Object.entries(taskCounts)
          .map(([status, count]) => `${count} ${status}`)
          .join(", "),
    );
  }

  if (recentSessions.length > 0) {
    lines.push("");
    lines.push("**Recent work sessions:**");
    for (const s of recentSessions) {
      const duration = s.durationMs ? `${Math.round(s.durationMs / 1000)}s` : "unknown";
      lines.push(`- [${s.status}] ${s.trigger} — ${s.summary ?? "no summary"} (${duration})`);
    }
  }

  lines.push("");
  lines.push(
    "Based on this context, either: (1) execute pending tasks on an active goal using create_plan, " +
      "(2) research and advance a stale goal, or (3) if a scheduled directive is given, follow it. " +
      "Be focused and produce concrete results.",
  );

  return lines.join("\n");
}

export async function runAutonomousSession(
  db: Db,
  registry: LlmRegistry,
  embeddingService?: EmbeddingService,
  sandboxService?: SandboxService,
  workspaceService?: WorkspaceService,
  options?: SessionOptions,
): Promise<SessionResult> {
  const timeBudgetMs = options?.timeBudgetMs ?? parseInt(optionalEnv("SESSION_TIME_BUDGET_MS", "900000"), 10);
  const tokenBudget = options?.tokenBudget ?? parseInt(optionalEnv("SESSION_TOKEN_BUDGET", "50000"), 10);
  const trigger = options?.trigger ?? "manual";
  const webhookUrl = options?.webhookUrl ?? optionalEnv("DISCORD_FOLLOWUP_WEBHOOK_URL", "");

  const startTime = Date.now();

  // Check daily token limit before starting
  const dailyTokenLimit = parseInt(optionalEnv("DAILY_TOKEN_LIMIT", "0"), 10);
  if (dailyTokenLimit > 0) {
    const todayTotal = await getTodayTokenTotal(db);
    if (todayTotal >= dailyTokenLimit) {
      logger.warn({ todayTotal, dailyTokenLimit, trigger }, "daily token limit reached, skipping autonomous session");
      return {
        sessionId: "",
        status: "failed",
        summary: "Daily token limit reached",
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Create work session record
  const session = await createWorkSession(db, {
    trigger,
    scheduleId: options?.scheduleId,
    eventId: options?.eventId,
    context: { timeBudgetMs, tokenBudget, prompt: options?.prompt },
  });

  logger.info(
    { sessionId: session.id, trigger, timeBudgetMs, tokenBudget },
    "autonomous session started",
  );

  if (webhookUrl) {
    await sendWebhook(webhookUrl, {
      embeds: [
        {
          title: "Autonomous session started",
          description: options?.prompt
            ? `**Directive:** ${options.prompt}`
            : "Analyzing active goals and deciding what to work on...",
          color: 3447003, // blue
          footer: { text: `Session ${session.id}` },
        },
      ],
    });
  }

  let totalTokens = 0;
  let status: "completed" | "failed" | "timeout" = "completed";
  let summary = "";

  try {
    const contextPrompt = await buildContextPrompt(db, options?.prompt);

    // Check time budget
    if (Date.now() - startTime > timeBudgetMs) {
      status = "timeout";
      summary = "Session timed out before orchestrator could run.";
    } else {
      const orchestrator = new Orchestrator(
        registry,
        db,
        "planning",
        embeddingService,
        undefined, // n8nService — not needed in autonomous context
        sandboxService,
        workspaceService,
      );

      const result = await Promise.race([
        orchestrator.run(contextPrompt, session.id),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeBudgetMs - (Date.now() - startTime))),
      ]);

      if (result === null) {
        status = "timeout";
        summary = "Session timed out during orchestrator execution.";
      } else {
        totalTokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
        summary = result.response.slice(0, 2000);

        if (totalTokens > tokenBudget) {
          logger.warn({ totalTokens, tokenBudget }, "token budget exceeded");
        }

        if (result.plan) {
          summary = `Created plan: "${result.plan.goalTitle}" with ${result.plan.tasks.length} tasks. ${summary}`;
        }
      }
    }
  } catch (err) {
    status = "failed";
    summary = err instanceof Error ? err.message : String(err);
    logger.error({ err, sessionId: session.id }, "autonomous session failed");
  }

  const durationMs = Date.now() - startTime;

  // Complete the work session record
  await completeWorkSession(db, session.id, {
    tokensUsed: totalTokens,
    durationMs,
    status,
    summary,
  });

  logger.info(
    { sessionId: session.id, status, durationMs, tokensUsed: totalTokens },
    "autonomous session completed",
  );

  if (webhookUrl) {
    const color = status === "completed" ? 3066993 : status === "timeout" ? 16098851 : 15158332; // green, amber, red
    await sendWebhook(webhookUrl, {
      embeds: [
        {
          title: `Session ${status}`,
          description: summary.slice(0, 1500),
          color,
          fields: [
            { name: "Duration", value: `${Math.round(durationMs / 1000)}s`, inline: true },
            { name: "Tokens", value: String(totalTokens), inline: true },
            { name: "Trigger", value: trigger, inline: true },
          ],
          footer: { text: `Session ${session.id}` },
        },
      ],
    });
  }

  return {
    sessionId: session.id,
    status,
    summary,
    tokensUsed: totalTokens,
    durationMs,
  };
}
