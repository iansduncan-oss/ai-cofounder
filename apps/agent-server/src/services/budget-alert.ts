import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { getUsageSummary } from "@ai-cofounder/db";
import type { Db } from "@ai-cofounder/db";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("budget-alert");

/**
 * BudgetAlertService — monitors LLM spend against configured thresholds and
 * fires Slack/Discord notifications when daily or weekly budgets are exceeded.
 *
 * De-duplication: alerts are keyed by "daily-YYYY-MM-DD" / "weekly-YYYY-MM-DD"
 * so only one notification fires per calendar day even if the job runs frequently.
 *
 * Optimization suggestions are generated algorithmically (no LLM call) by
 * inspecting the byModel and byAgent breakdown from getUsageSummary().
 */
export class BudgetAlertService {
  private firedAlerts = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Check daily and weekly budgets and fire a notification if exceeded.
   * Call this from the BullMQ budget_check monitoring job (every 60 seconds).
   */
  async checkBudgets(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    const dailyBudget = parseFloat(optionalEnv("DAILY_BUDGET_USD", "0"));
    const weeklyBudget = parseFloat(optionalEnv("WEEKLY_BUDGET_USD", "0"));

    // ── Daily check ──
    if (dailyBudget > 0) {
      const dailyKey = `daily-${today}`;
      if (!this.firedAlerts.has(dailyKey)) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const usage = await getUsageSummary(this.db, { since: todayStart });
        if (usage.totalCostUsd >= dailyBudget) {
          const message =
            `Budget alert: daily LLM spend has reached $${usage.totalCostUsd.toFixed(4)} ` +
            `(limit: $${dailyBudget.toFixed(2)}). ` +
            `${usage.requestCount} requests today.`;
          await this.notificationService.sendBriefing(message);
          this.firedAlerts.add(dailyKey);
          logger.warn({ dailySpend: usage.totalCostUsd, limit: dailyBudget }, "daily budget exceeded");
        }
      }
    }

    // ── Weekly check ──
    if (weeklyBudget > 0) {
      const weeklyKey = `weekly-${today}`;
      if (!this.firedAlerts.has(weeklyKey)) {
        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - 7);
        const usage = await getUsageSummary(this.db, { since: weekStart });
        if (usage.totalCostUsd >= weeklyBudget) {
          const message =
            `Budget alert: weekly LLM spend has reached $${usage.totalCostUsd.toFixed(4)} ` +
            `(limit: $${weeklyBudget.toFixed(2)}). ` +
            `${usage.requestCount} requests this week.`;
          await this.notificationService.sendBriefing(message);
          this.firedAlerts.add(weeklyKey);
          logger.warn({ weeklySpend: usage.totalCostUsd, limit: weeklyBudget }, "weekly budget exceeded");
        }
      }
    }
  }

  /**
   * Generate algorithmic optimization suggestions based on 7-day usage breakdown.
   * Returns an array of actionable suggestion strings.
   * No LLM call — purely rule-based for minimal latency.
   */
  async generateOptimizationSuggestions(): Promise<string[]> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const usage = await getUsageSummary(this.db, { since: weekAgo });

    const suggestions: string[] = [];

    // Check for expensive Opus models used for many requests
    for (const [model, stats] of Object.entries(usage.byModel)) {
      const isExpensive = model.toLowerCase().includes("opus") || model.toLowerCase().includes("claude-3-opus");
      if (isExpensive && stats.requests > 10) {
        suggestions.push(
          `Model "${model}" was used for ${stats.requests} requests ($${stats.costUsd.toFixed(4)} total). ` +
          `Consider routing routine tasks to a cheaper model like claude-haiku or groq.`,
        );
      }
    }

    // Check for high orchestrator cost relative to total
    const totalCost = usage.totalCostUsd;
    if (totalCost > 0) {
      for (const [agent, stats] of Object.entries(usage.byAgent)) {
        const agentShare = stats.costUsd / totalCost;
        if (agent.toLowerCase() === "orchestrator" && agentShare > 0.7 && stats.requests > 10) {
          suggestions.push(
            `The orchestrator agent consumed ${(agentShare * 100).toFixed(0)}% of total LLM cost ` +
            `($${stats.costUsd.toFixed(4)} / $${totalCost.toFixed(4)}). ` +
            `Consider delegating more tasks to cheaper specialist agents.`,
          );
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push("No optimization opportunities detected based on current usage patterns.");
    }

    return suggestions;
  }
}
