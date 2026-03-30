import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listGoalBacklog,
  listRecentWorkSessions,
  countTasksByStatus,
  createWorkSession,
  completeWorkSession,
  getTodayTokenTotal,
} from "@ai-cofounder/db";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { WorkspaceService } from "./services/workspace.js";
import type { AgentMessagingService } from "./services/agent-messaging.js";
import { Orchestrator } from "./agents/orchestrator.js";
import type { DiscordService } from "./services/discord.js";
import type { VpsCommandService } from "./services/vps-command.js";
import type { DistributedLockService} from "./services/distributed-lock.js";
import { AUTONOMOUS_SESSION_LOCK } from "./services/distributed-lock.js";
import { TokenBudgetExceededError } from "./services/autonomous-executor.js";
import { ProceduralMemoryService } from "./services/procedural-memory.js";

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
  /** Discord service for reading channel messages */
  discordService?: DiscordService;
  /** VPS command service for infrastructure management */
  vpsCommandService?: VpsCommandService;
}

export interface SessionResult {
  sessionId: string;
  status: "completed" | "failed" | "timeout" | "skipped" | "aborted";
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

async function buildContextPrompt(db: Db, overridePrompt?: string, vpsCommandService?: VpsCommandService, discordService?: DiscordService): Promise<string> {
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

  // Infrastructure health snapshot
  if (vpsCommandService) {
    try {
      const healthResult = await vpsCommandService.execute(
        "echo DISK=$(df -h / | tail -1 | awk '{print $5}') MEM=$(free | grep Mem | awk '{printf \"%.0f%%\", $3/$2*100}') CPU=$(cat /proc/loadavg | awk '{print $1}')",
        { timeoutSeconds: 10 },
      );
      if (healthResult.exitCode === 0 && healthResult.stdout) {
        lines.push("");
        lines.push(`**VPS health:** ${healthResult.stdout}`);
      }
      const containerResult = await vpsCommandService.execute(
        "docker ps --format '{{.Names}} {{.Status}}' | grep -i unhealthy || echo 'All containers healthy'",
        { timeoutSeconds: 10 },
      );
      if (containerResult.exitCode === 0 && containerResult.stdout) {
        lines.push(`**Containers:** ${containerResult.stdout}`);
      }
    } catch {
      // Non-fatal — skip VPS health in context
    }
  }

  // Discord recent activity (check for errors/requests)
  if (discordService) {
    try {
      const channels = await discordService.fetchChannels();
      const alertChannels = channels.filter((c) =>
        /alert|error|monitor|deploy|bot|general/i.test(c.name),
      );
      if (alertChannels.length > 0) {
        const recentMessages: string[] = [];
        for (const ch of alertChannels.slice(0, 3)) {
          const msgs = await discordService.fetchMessages(ch.id, { limit: 5 });
          const recent = msgs.filter((m) => {
            const age = Date.now() - new Date(m.timestamp).getTime();
            return age < 4 * 60 * 60 * 1000; // last 4 hours
          });
          if (recent.length > 0) {
            recentMessages.push(`#${ch.name}: ${recent.map((m) => `[${m.author}] ${m.content.slice(0, 150)}`).join(" | ")}`);
          }
        }
        if (recentMessages.length > 0) {
          lines.push("");
          lines.push("**Recent Discord activity:**");
          for (const msg of recentMessages) {
            lines.push(`- ${msg}`);
          }
        }
      }
    } catch {
      // Non-fatal — skip Discord context
    }
  }

  lines.push("");
  lines.push(
    "You are the AI Cofounder. Prioritize your work in this order:\n" +
      "1. **Fix infrastructure issues** — if VPS health shows problems or containers are unhealthy, diagnose and fix them first using docker_service_logs and execute_vps_command.\n" +
      "2. **Respond to Discord requests** — if someone asked for something or there are error alerts, address them.\n" +
      "3. **Execute pending tasks** — pick the highest-priority active goal and work on it using create_plan.\n" +
      "4. **Follow scheduled directives** — if one was provided, execute it.\n" +
      "5. **Proactive improvement** — if everything is healthy, look for optimizations or advance stale goals.\n" +
      "After completing work, save lessons learned to procedural memory for future sessions. " +
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
  messagingService?: AgentMessagingService,
  lockService?: DistributedLockService,
  options?: SessionOptions,
): Promise<SessionResult> {
  const timeBudgetMs = options?.timeBudgetMs ?? parseInt(optionalEnv("SESSION_TIME_BUDGET_MS", "900000"), 10);
  const tokenBudget = options?.tokenBudget ?? parseInt(optionalEnv("SESSION_TOKEN_BUDGET", "50000"), 10);
  const trigger = options?.trigger ?? "manual";
  const webhookUrl = options?.webhookUrl ?? optionalEnv("DISCORD_FOLLOWUP_WEBHOOK_URL", "");

  const startTime = Date.now();

  // Acquire distributed lock to prevent concurrent sessions
  let lockToken: string | null = null;
  if (lockService) {
    const lockTtlMs = timeBudgetMs + 120_000; // 2-minute buffer over time budget
    lockToken = await lockService.acquire(AUTONOMOUS_SESSION_LOCK, lockTtlMs);
    if (lockToken === null) {
      logger.warn({ trigger }, "another autonomous session is already running, skipping");
      return {
        sessionId: "",
        status: "skipped",
        summary: "Another autonomous session is already running",
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
      };
    }
    logger.info("distributed lock acquired for autonomous session");
  }

  try {
    return await _runSessionBody(db, registry, embeddingService, sandboxService, workspaceService, messagingService, {
      timeBudgetMs, tokenBudget, trigger, webhookUrl, startTime, options,
    });
  } finally {
    if (lockService && lockToken) {
      await lockService.release(AUTONOMOUS_SESSION_LOCK, lockToken);
      logger.info("distributed lock released");
    }
  }
}

async function _runSessionBody(
  db: Db,
  registry: LlmRegistry,
  embeddingService: EmbeddingService | undefined,
  sandboxService: SandboxService | undefined,
  workspaceService: WorkspaceService | undefined,
  messagingService: AgentMessagingService | undefined,
  ctx: {
    timeBudgetMs: number;
    tokenBudget: number;
    trigger: string;
    webhookUrl: string;
    startTime: number;
    options?: SessionOptions;
  },
): Promise<SessionResult> {
  const { timeBudgetMs, tokenBudget, trigger, webhookUrl, startTime, options } = ctx;

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
    // Attempt deterministic goal pickup from backlog
    const backlog = await listGoalBacklog(db, 1);
    if (backlog.length > 0) {
      const topGoal = backlog[0];
      logger.info({ goalId: topGoal.id, goalTitle: topGoal.title }, "picked goal from backlog");

      // Use dynamic import to avoid circular dependency issues
      const { AutonomousExecutorService } = await import("./services/autonomous-executor.js");
      const { TaskDispatcher } = await import("./agents/dispatcher.js");

      const dispatcher = new TaskDispatcher(registry, db, embeddingService, sandboxService, undefined, workspaceService);
      const executor = new AutonomousExecutorService(dispatcher, workspaceService, db, registry);

      try {
        const { progress, actions, tokensUsed: execTokens } = await executor.executeGoal({
          goalId: topGoal.id,
          userId: "system-autonomous",
          workSessionId: session.id,
          repoDir: workspaceService ? optionalEnv("WORKSPACE_DIR", "/tmp/ai-cofounder-workspace") : undefined,
          createPr: true,
          tokenBudget,
          onProgress: async (_event) => {
            // Progress events are published through the BullMQ worker path
            // when triggered via enqueueAgentTask; no-op here for direct execution
          },
        });

        totalTokens = execTokens || progress.tasks.reduce((sum, t) => sum + ((t as Record<string, unknown>).tokensUsed as number ?? 0), 0);
        status = progress.status === "completed" ? "completed" : "failed";
        summary = `Executed goal "${topGoal.title}" — ${progress.completedTasks}/${progress.totalTasks} tasks completed`;

        await completeWorkSession(db, session.id, {
          tokensUsed: totalTokens,
          durationMs: Date.now() - startTime,
          actionsTaken: { actions, goalId: topGoal.id, goalTitle: topGoal.title },
          status,
          summary,
        });

        logger.info(
          { sessionId: session.id, status, goalId: topGoal.id, tokensUsed: totalTokens },
          "backlog-driven autonomous session completed",
        );

        if (webhookUrl) {
          const color = status === "completed" ? 3066993 : 15158332; // green or red
          await sendWebhook(webhookUrl, {
            embeds: [
              {
                title: `Session ${status}`,
                description: summary.slice(0, 1500),
                color,
                fields: [
                  { name: "Duration", value: `${Math.round((Date.now() - startTime) / 1000)}s`, inline: true },
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
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        // Token budget exceeded — abort cleanly between tasks
        if (err instanceof TokenBudgetExceededError) {
          totalTokens = err.tokensUsed;
          const abortSummary = `Session aborted: token budget (${tokenBudget}) exceeded after task "${err.lastTaskTitle ?? "unknown"}". ${err.tokensUsed} tokens used of ${err.budget} budget.`;
          await completeWorkSession(db, session.id, {
            tokensUsed: totalTokens,
            durationMs: Date.now() - startTime,
            status: "aborted",
            summary: abortSummary,
          });
          logger.warn({ tokensUsed: err.tokensUsed, budget: err.budget }, "session aborted due to token budget");

          if (webhookUrl) {
            await sendWebhook(webhookUrl, {
              embeds: [{
                title: "Session aborted",
                description: abortSummary.slice(0, 1500),
                color: 16098851, // amber
                fields: [
                  { name: "Duration", value: `${Math.round((Date.now() - startTime) / 1000)}s`, inline: true },
                  { name: "Tokens", value: String(totalTokens), inline: true },
                  { name: "Trigger", value: trigger, inline: true },
                ],
                footer: { text: `Session ${session.id}` },
              }],
            });
          }

          return {
            sessionId: session.id,
            status: "aborted",
            summary: abortSummary,
            tokensUsed: totalTokens,
            durationMs: Date.now() - startTime,
          };
        }

        // Fall through to freeform orchestrator as fallback
        logger.warn({ err, goalId: topGoal.id }, "backlog executor failed, falling back to freeform orchestrator");
      }
    }

    // Freeform orchestrator fallback — used when no backlog goals exist or backlog path fails
    const contextPrompt = await buildContextPrompt(db, options?.prompt, options?.vpsCommandService, options?.discordService);

    // Check time budget
    if (Date.now() - startTime > timeBudgetMs) {
      status = "timeout";
      summary = "Session timed out before orchestrator could run.";
    } else {
      const orchestrator = new Orchestrator({
        registry,
        db,
        taskCategory: "planning",
        embeddingService,
        sandboxService,
        workspaceService,
        messagingService,
        discordService: options?.discordService,
        vpsCommandService: options?.vpsCommandService,
        isAutonomous: true,
      });

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

  // Self-improvement: extract a lesson from the session (best-effort)
  if (status === "completed" && summary) {
    try {
      const embedFn = embeddingService
        ? (text: string) => embeddingService.embed(text)
        : async () => [];
      const proceduralMemory = new ProceduralMemoryService(db, registry, embedFn);
      const lesson = await proceduralMemory.learnFromSession(summary, status);
      if (lesson) {
        logger.info({ procedureId: lesson.id, trigger: lesson.triggerPattern }, "session self-improvement lesson saved");
      }
    } catch (err) {
      logger.warn({ err }, "self-improvement reflection failed (non-fatal)");
    }
  }

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
