import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { upsertSessionEngagement, getLatestSessionEngagement } from "@ai-cofounder/db";

const logger = createLogger("session-engagement");

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

export type EnergyLevel = "high" | "normal" | "low";

/**
 * SessionEngagementService — tracks user session interaction metrics.
 * Measures message frequency, complexity, and derives engagement level.
 */
export class SessionEngagementService {
  constructor(private readonly db: Db) {}

  /**
   * Record a message in the user's current session.
   * Creates a new session if the gap since last message exceeds 30min.
   */
  async recordMessage(userId: string, message: string, isUserMessage: boolean): Promise<void> {
    try {
      const now = new Date();
      const existing = await getLatestSessionEngagement(this.db, userId);

      const isNewSession =
        !existing ||
        !existing.lastMessageAt ||
        now.getTime() - new Date(existing.lastMessageAt).getTime() > SESSION_GAP_MS;

      if (isNewSession) {
        const complexity = this.scoreComplexity(message);
        await upsertSessionEngagement(this.db, {
          userId,
          sessionStart: now,
          messageCount: 1,
          avgMessageLength: message.length,
          avgResponseIntervalMs: 0,
          complexityScore: complexity,
          energyLevel: this.deriveEnergyLevel(1, complexity, 0),
          lastMessageAt: now,
        });
        return;
      }

      // Update running session
      const newCount = existing.messageCount + 1;
      const newAvgLength = Math.round(
        (existing.avgMessageLength * existing.messageCount + message.length) / newCount,
      );
      const intervalMs = existing.lastMessageAt
        ? now.getTime() - new Date(existing.lastMessageAt).getTime()
        : 0;
      const newAvgInterval = isUserMessage && intervalMs > 0
        ? Math.round(
            (existing.avgResponseIntervalMs * Math.max(existing.messageCount - 1, 0) + intervalMs) /
              Math.max(existing.messageCount, 1),
          )
        : existing.avgResponseIntervalMs;
      const complexity = Math.round(
        (existing.complexityScore * existing.messageCount + this.scoreComplexity(message)) / newCount,
      );
      const energyLevel = this.deriveEnergyLevel(newCount, complexity, newAvgInterval);

      await upsertSessionEngagement(this.db, {
        id: existing.id,
        userId,
        messageCount: newCount,
        avgMessageLength: newAvgLength,
        avgResponseIntervalMs: newAvgInterval,
        complexityScore: complexity,
        energyLevel,
        lastMessageAt: now,
      });
    } catch (err) {
      logger.debug({ err }, "failed to record session engagement");
    }
  }

  /**
   * Get engagement context for system prompt assembly.
   */
  async getEngagementContext(userId: string): Promise<string | null> {
    try {
      const session = await getLatestSessionEngagement(this.db, userId);
      if (!session) return null;

      // Check if session is still active
      const now = new Date();
      if (!session.lastMessageAt || now.getTime() - new Date(session.lastMessageAt).getTime() > SESSION_GAP_MS) {
        return null;
      }

      const level = session.energyLevel as EnergyLevel;
      const guidance: Record<EnergyLevel, string> = {
        high: "User is highly engaged — detailed responses and proactive suggestions welcome.",
        normal: "Standard engagement — balanced detail level.",
        low: "Low engagement — keep responses concise, focus on essentials.",
      };

      return `${guidance[level] ?? guidance.normal} (${session.messageCount} messages this session, complexity: ${session.complexityScore}/100)`;
    } catch (err) {
      logger.debug({ err }, "failed to get engagement context");
      return null;
    }
  }

  /**
   * Score message complexity 0-100 based on heuristics.
   */
  scoreComplexity(message: string): number {
    let score = 30; // baseline

    // Length factor
    if (message.length > 500) score += 15;
    else if (message.length > 200) score += 10;
    else if (message.length < 20) score -= 10;

    // Question marks suggest analytical thinking
    const questions = (message.match(/\?/g) || []).length;
    score += Math.min(questions * 5, 15);

    // Code blocks indicate technical content
    const codeBlocks = (message.match(/```/g) || []).length;
    score += Math.min(codeBlocks * 10, 20);

    // Technical terms
    const technicalTerms = /\b(deploy|api|database|schema|migration|refactor|debug|optimize|architecture|pipeline)\b/gi;
    const techMatches = (message.match(technicalTerms) || []).length;
    score += Math.min(techMatches * 3, 15);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Derive energy level from session metrics.
   */
  deriveEnergyLevel(messageCount: number, complexity: number, avgIntervalMs: number): EnergyLevel {
    // High: many messages, high complexity, fast responses
    if (messageCount >= 10 && complexity >= 60) return "high";
    if (messageCount >= 5 && avgIntervalMs > 0 && avgIntervalMs < 60_000) return "high";

    // Low: few messages, low complexity, or very slow responses
    if (messageCount <= 2 && complexity < 30) return "low";
    if (avgIntervalMs > 300_000) return "low"; // > 5 min between messages

    return "normal";
  }
}
