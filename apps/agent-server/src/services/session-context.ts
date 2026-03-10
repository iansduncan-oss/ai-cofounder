import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getRecentSessionSummaries,
  getLastUserMessageTimestamp,
  getRecentDecisionMemories,
  listRecentlyCompletedGoals,
  listReflections,
} from "@ai-cofounder/db";

const logger = createLogger("session-context");

// ~250 chars per summary, ~3 summaries = ~750 chars total ≈ ~180 tokens
const SUMMARY_CHAR_LIMIT = 250;
const RETURN_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

export class SessionContextService {
  constructor(private db: Db) {}

  /**
   * Get a formatted "Recent Sessions" block for the given user.
   * Returns null if the user has no recent session summaries.
   * Output is capped at ~800 tokens via 250-char per-summary truncation.
   */
  async getRecentContext(userId: string, limit = 3): Promise<string | null> {
    try {
      const summaries = await getRecentSessionSummaries(this.db, userId, limit);

      if (summaries.length === 0) {
        return null;
      }

      const lines: string[] = ["## Recent Sessions"];

      summaries.forEach((s, index) => {
        const label =
          index === 0 ? "Session 1 (most recent):" : `Session ${index + 1}:`;
        const truncated =
          s.summary.length > SUMMARY_CHAR_LIMIT
            ? s.summary.slice(0, SUMMARY_CHAR_LIMIT)
            : s.summary;
        lines.push(label);
        lines.push(truncated);
        lines.push("");
      });

      // Remove trailing empty line
      if (lines[lines.length - 1] === "") lines.pop();

      return lines.join("\n");
    } catch (err) {
      logger.warn({ err, userId }, "session context retrieval failed (non-fatal)");
      return null;
    }
  }

  /**
   * Build a "welcome back" context block when a user returns after 2+ hours.
   * Returns null if the gap is less than 2 hours or no last message exists.
   */
  async getReturnContext(userId: string): Promise<string | null> {
    try {
      const lastMessageTime = await getLastUserMessageTimestamp(this.db, userId);
      if (!lastMessageTime) return null;

      const gapMs = Date.now() - lastMessageTime.getTime();
      if (gapMs < RETURN_GAP_MS) return null;

      const lines: string[] = ["## Since You Were Last Here"];
      lines.push(`*Last message: ${this.formatTimeGap(gapMs)} ago*`);

      // Last session summary
      const summaries = await getRecentSessionSummaries(this.db, userId, 1);
      if (summaries.length > 0) {
        const summary = summaries[0].summary.length > SUMMARY_CHAR_LIMIT
          ? summaries[0].summary.slice(0, SUMMARY_CHAR_LIMIT) + "..."
          : summaries[0].summary;
        lines.push("");
        lines.push("**Last session:**");
        lines.push(summary);
      }

      // Decisions made since last message
      const decisions = await getRecentDecisionMemories(this.db, userId, lastMessageTime);
      if (decisions.length > 0) {
        lines.push("");
        lines.push("**Decisions recorded:**");
        for (const d of decisions.slice(0, 5)) {
          lines.push(`- ${d.key}: ${d.content.slice(0, 100)}`);
        }
      }

      // Completed goals since last message
      const completedGoals = await listRecentlyCompletedGoals(this.db, lastMessageTime);
      if (completedGoals.length > 0) {
        lines.push("");
        lines.push("**Goals completed:**");
        for (const g of completedGoals.slice(0, 5)) {
          lines.push(`- ${g.title}`);
        }
      }

      // Recent reflections with lessons
      try {
        const reflectionsResult = await listReflections(this.db, { limit: 5 });
        const recentReflections = reflectionsResult.data.filter(
          (r) =>
            r.createdAt >= lastMessageTime &&
            r.lessons != null &&
            (r.lessons as unknown[]).length > 0,
        );
        if (recentReflections.length > 0) {
          lines.push("");
          lines.push("**Lessons learned:**");
          for (const r of recentReflections.slice(0, 3)) {
            const lessons = r.lessons as Array<{ lesson: string }>;
            for (const l of lessons.slice(0, 2)) {
              lines.push(`- ${l.lesson}`);
            }
          }
        }
      } catch {
        // Non-fatal
      }

      // Only return if we have more than just the header and timestamp
      if (lines.length <= 2) return null;

      return lines.join("\n");
    } catch (err) {
      logger.warn({ err, userId }, "return context retrieval failed (non-fatal)");
      return null;
    }
  }

  private formatTimeGap(ms: number): string {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? "s" : ""}`;
  }
}
