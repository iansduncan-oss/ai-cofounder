/**
 * Tool efficacy tracking — queries toolExecutions for success rate and latency,
 * generates system prompt hints for underperforming tools.
 */

import type { Db } from "@ai-cofounder/db";
import { getToolStats } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("tool-efficacy");

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

interface EfficacyHint {
  toolName: string;
  successRate: number;
  avgLatencyMs: number;
  totalCalls: number;
}

export class ToolEfficacyService {
  private cachedHints: string | null = null;
  private lastRefresh = 0;

  constructor(private db: Db) {}

  async getEfficacyHints(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedHints !== null && now - this.lastRefresh < REFRESH_INTERVAL_MS) {
      return this.cachedHints;
    }

    try {
      const stats = await getToolStats(this.db);
      const hints = this.analyzeStats(stats);
      this.cachedHints = hints;
      this.lastRefresh = now;
      return hints;
    } catch (err) {
      logger.warn({ err }, "failed to fetch tool efficacy stats");
      return this.cachedHints;
    }
  }

  private analyzeStats(
    stats: Array<{ toolName: string; totalExecutions: number; successCount: number; errorCount: number; avgDurationMs: number; p95DurationMs: number; maxDurationMs: number }>,
  ): string | null {
    const issues: EfficacyHint[] = [];

    for (const stat of stats) {
      if (stat.totalExecutions < 5) continue; // Not enough data
      const successRate = stat.successCount / stat.totalExecutions;
      const avgLatencyMs = stat.avgDurationMs;

      if (successRate < 0.8 || avgLatencyMs > 10000) {
        issues.push({
          toolName: stat.toolName,
          successRate,
          avgLatencyMs,
          totalCalls: stat.totalExecutions,
        });
      }
    }

    if (issues.length === 0) return null;

    const lines = ["## Tool performance hints"];
    for (const hint of issues.slice(0, 5)) {
      const rate = (hint.successRate * 100).toFixed(0);
      const latency = (hint.avgLatencyMs / 1000).toFixed(1);
      const parts: string[] = [];
      if (hint.successRate < 0.8) parts.push(`${rate}% success rate`);
      if (hint.avgLatencyMs > 10000) parts.push(`${latency}s avg latency`);
      lines.push(`- ${hint.toolName}: ${parts.join(", ")} (${hint.totalCalls} calls)`);
    }

    return lines.join("\n");
  }

  clearCache(): void {
    this.cachedHints = null;
    this.lastRefresh = 0;
  }
}
