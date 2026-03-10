import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getRecentSessionSummaries } from "@ai-cofounder/db";

const logger = createLogger("session-context");

// ~250 chars per summary, ~3 summaries = ~750 chars total ≈ ~180 tokens
const SUMMARY_CHAR_LIMIT = 250;

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
}
