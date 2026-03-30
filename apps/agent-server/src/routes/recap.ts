import type { FastifyPluginAsync } from "fastify";
import { optionalEnv, createLogger } from "@ai-cofounder/shared";
import {
  listActiveGoals,
  countTasksByStatus,
  listRecentWorkSessions,
  getUsageSummary,
  getAppSetting,
  getToolStats,
  listPendingApprovals,
} from "@ai-cofounder/db";

const logger = createLogger("recap");

export const recapRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/recap — Generate and post a system recap to Discord.
   * Protected by a simple token query param (RECAP_TOKEN env var).
   * Designed to be called by scheduled triggers.
   */
  app.post<{ Querystring: { token?: string }; Body: { period?: string } }>(
    "/",
    { schema: { tags: ["recap"] } },
    async (request, reply) => {
      const recapToken = optionalEnv("RECAP_TOKEN", "");
      if (recapToken && request.query.token !== recapToken) {
        return reply.status(401).send({ error: "Invalid recap token" });
      }

      const webhookUrl = optionalEnv("DISCORD_FOLLOWUP_WEBHOOK_URL", "");
      if (!webhookUrl) {
        return reply.status(500).send({ error: "No Discord webhook configured" });
      }

      const period = request.body?.period ?? "today";
      const now = new Date();
      const hour = now.getHours();
      const isMorning = hour < 14;
      const title = isMorning ? "Good Morning — Daily Recap" : "End of Day — Evening Recap";

      try {
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [
          activeGoals,
          taskCounts,
          recentSessions,
          costToday,
          costWeek,
          toolStats,
          pendingApprovals,
          dailyBudgetRaw,
          weeklyBudgetRaw,
        ] = await Promise.all([
          listActiveGoals(app.db),
          countTasksByStatus(app.db),
          listRecentWorkSessions(app.db, 10),
          getUsageSummary(app.db, { since: todayStart }),
          getUsageSummary(app.db, { since: weekAgo }),
          getToolStats(app.db),
          listPendingApprovals(app.db),
          getAppSetting(app.db, "daily_budget_usd"),
          getAppSetting(app.db, "weekly_budget_usd"),
        ]);

        const dailyLimit = dailyBudgetRaw ? parseFloat(dailyBudgetRaw) : 0;
        const weeklyLimit = weeklyBudgetRaw ? parseFloat(weeklyBudgetRaw) : 0;

        // Infrastructure health
        let infraStatus = "Unknown";
        let infraDetails = "";
        if (app.monitoringService) {
          try {
            const report = await app.monitoringService.runFullCheck();
            const vps = report.vps;
            if (vps) {
              infraStatus = report.alerts.some((a) => a.severity === "critical") ? "⚠️ Issues" : "✅ Healthy";
              infraDetails = `Disk: ${vps.diskUsagePercent}% | Mem: ${vps.memoryUsagePercent}% | CPU: ${vps.cpuLoadAvg[0]?.toFixed(1) ?? "?"}`;
              const unhealthy = vps.containers?.filter((c) => !c.status.includes("Up")) ?? [];
              if (unhealthy.length > 0) {
                infraDetails += `\n⚠️ Down: ${unhealthy.map((c) => c.name).join(", ")}`;
              }
            }
          } catch {
            infraStatus = "⚠️ Check failed";
          }
        }

        // Provider health
        const providers = app.llmRegistry.getProviderHealth();
        const onlineProviders = providers.filter((p) => p.available).map((p) => p.provider);
        const offlineProviders = providers.filter((p) => !p.available).map((p) => p.provider);

        // Sessions summary
        const todaySessions = recentSessions.filter((s) => new Date(s.createdAt) >= todayStart);
        const completedSessions = todaySessions.filter((s) => s.status === "completed").length;
        const failedSessions = todaySessions.filter((s) => s.status === "failed" || s.status === "timeout").length;
        const totalTokensToday = todaySessions.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0);

        // Top tools
        const topTools = toolStats
          .sort((a, b) => b.totalExecutions - a.totalExecutions)
          .slice(0, 5)
          .map((t) => `${t.toolName}: ${t.totalExecutions}x (${Math.round((t.successCount / t.totalExecutions) * 100)}%)`)
          .join("\n");

        // Goals summary
        const goalLines = activeGoals.slice(0, 8).map((g) => {
          const progress = g.taskCount > 0 ? `${g.completedTaskCount}/${g.taskCount}` : "no tasks";
          return `• [${g.priority}] ${g.title} (${progress})`;
        }).join("\n");

        // Blockers
        const blockers: string[] = [];
        if (offlineProviders.length > 0) blockers.push(`LLM providers offline: ${offlineProviders.join(", ")}`);
        if (pendingApprovals.length > 0) blockers.push(`${pendingApprovals.length} pending approval(s)`);
        if (failedSessions > 0) blockers.push(`${failedSessions} failed session(s) today`);

        const fields = [
          {
            name: "🖥️ Infrastructure",
            value: `${infraStatus}\n${infraDetails}`,
            inline: false,
          },
          {
            name: "🤖 Autonomous Sessions",
            value: `Today: ${completedSessions} completed, ${failedSessions} failed\nTokens: ${totalTokensToday.toLocaleString()}`,
            inline: true,
          },
          {
            name: "💰 Costs",
            value: `Today: $${costToday.totalCostUsd.toFixed(4)}${dailyLimit ? ` / $${dailyLimit.toFixed(2)}` : ""}\nWeek: $${costWeek.totalCostUsd.toFixed(4)}${weeklyLimit ? ` / $${weeklyLimit.toFixed(2)}` : ""}`,
            inline: true,
          },
          {
            name: "🔌 LLM Providers",
            value: onlineProviders.length > 0
              ? `Online: ${onlineProviders.join(", ")}${offlineProviders.length > 0 ? `\nOffline: ${offlineProviders.join(", ")}` : ""}`
              : "No providers available",
            inline: true,
          },
          {
            name: "🎯 Active Goals",
            value: goalLines || "No active goals",
            inline: false,
          },
          {
            name: "🔧 Top Tools",
            value: topTools || "No tool data",
            inline: true,
          },
          {
            name: "📋 Tasks",
            value: `Pending: ${taskCounts["pending"] ?? 0} | Running: ${taskCounts["running"] ?? 0} | Completed: ${taskCounts["completed"] ?? 0} | Failed: ${taskCounts["failed"] ?? 0}`,
            inline: true,
          },
        ];

        if (blockers.length > 0) {
          fields.push({
            name: "🚧 Blockers",
            value: blockers.map((b) => `• ${b}`).join("\n"),
            inline: false,
          });
        }

        const embed = {
          title,
          color: blockers.length > 0 ? 16098851 : 3066993, // amber if blockers, green otherwise
          fields,
          footer: { text: `Generated ${now.toISOString()}` },
        };

        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] }),
        });

        if (!res.ok) {
          logger.warn({ status: res.status }, "Discord webhook returned non-OK");
        }

        logger.info({ period, fieldsCount: fields.length }, "recap posted to Discord");
        return { ok: true, period, blockers: blockers.length };
      } catch (err) {
        logger.error({ err }, "recap generation failed");
        return reply.status(500).send({ error: "Recap generation failed" });
      }
    },
  );
};
