import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listPendingApprovals,
  getRecentUserActionSummary,
  getTriggeredPatterns,
} from "@ai-cofounder/db";

const logger = createLogger("contextual-awareness");

export type TimePeriod = "early_morning" | "morning" | "afternoon" | "evening" | "late_night";

const TONE_GUIDANCE: Record<TimePeriod, string> = {
  early_morning: "Keep responses concise — the user may be starting their day and scanning quickly.",
  morning: "Good energy window — suitable for planning, strategy, and complex discussions.",
  afternoon: "Mid-day focus — be direct and action-oriented.",
  evening: "Wind-down mode — summarize progress and highlight what's next for tomorrow.",
  late_night: "Late session — keep responses brief, avoid proposing large new initiatives.",
};

export interface ContextualAwarenessOptions {
  timezone?: string;
}

export class ContextualAwarenessService {
  private db: Db;
  private timezone: string;

  constructor(db: Db, options?: ContextualAwarenessOptions) {
    this.db = db;
    this.timezone = options?.timezone ?? "America/New_York";
  }

  classifyTimePeriod(hour: number): TimePeriod {
    if (hour < 6) return "late_night";
    if (hour < 9) return "early_morning";
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    if (hour < 21) return "evening";
    return "late_night";
  }

  async getContextBlock(userId?: string): Promise<string | null> {
    try {
      const now = new Date();
      const timeStr = new Intl.DateTimeFormat("en-US", {
        timeZone: this.timezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(now);

      const hour = parseInt(
        new Intl.DateTimeFormat("en-US", {
          timeZone: this.timezone,
          hour: "numeric",
          hour12: false,
        }).format(now),
        10,
      );

      const _dayOfWeek = parseInt(
        new Intl.DateTimeFormat("en-US", {
          timeZone: this.timezone,
          weekday: "narrow",
        })
          .formatToParts(now)
          .find((p) => p.type === "weekday")?.value ?? "0",
        10,
      );

      const period = this.classifyTimePeriod(hour);
      const lines: string[] = ["## Current Context"];
      lines.push(`**Time:** ${timeStr} (${this.timezone})`);
      lines.push(`**Period:** ${period.replace("_", " ")}`);

      // Recent activity summary
      if (userId) {
        const since = new Date(now.getTime() - 2 * 60 * 60 * 1000); // last 2 hours
        try {
          const actionSummary = await getRecentUserActionSummary(this.db, userId, since);
          if (actionSummary.length > 0) {
            const parts = actionSummary.map(
              (a) => `${a.actionType.replace("_", " ")} (${a.count})`,
            );
            lines.push(`**Recent activity (2h):** ${parts.join(", ")}`);
          }
        } catch (err) {
          logger.debug({ err }, "failed to fetch user action summary");
        }
      }

      // Active goals + pending approvals
      try {
        const [activeGoals, pendingApprovals] = await Promise.all([
          listActiveGoals(this.db),
          listPendingApprovals(this.db),
        ]);
        if (activeGoals.length > 0 || pendingApprovals.length > 0) {
          const statusParts: string[] = [];
          if (activeGoals.length > 0) statusParts.push(`${activeGoals.length} active goal(s)`);
          if (pendingApprovals.length > 0) statusParts.push(`${pendingApprovals.length} pending approval(s)`);
          lines.push(`**Status:** ${statusParts.join(", ")}`);
        }
      } catch (err) {
        logger.debug({ err }, "failed to fetch goals/approvals");
      }

      // Triggered patterns
      if (userId) {
        try {
          // Resolve actual dayOfWeek from timezone-adjusted date
          const adjustedDay = new Date(
            now.toLocaleString("en-US", { timeZone: this.timezone }),
          ).getDay();

          const patterns = await getTriggeredPatterns(this.db, userId, {
            dayOfWeek: adjustedDay,
            hourOfDay: hour,
          });
          if (patterns.length > 0) {
            lines.push("**Suggestions based on your patterns:**");
            for (const p of patterns.slice(0, 3)) {
              lines.push(`- ${p.suggestedAction}`);
            }
          }
        } catch (err) {
          logger.debug({ err }, "failed to fetch triggered patterns");
        }
      }

      // Tone guidance
      lines.push(`**Tone:** ${TONE_GUIDANCE[period]}`);

      return lines.join("\n");
    } catch (err) {
      logger.warn({ err }, "contextual awareness failed");
      return null;
    }
  }
}
