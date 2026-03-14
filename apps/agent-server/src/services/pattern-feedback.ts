import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listPatterns,
  adjustPatternConfidence,
  deactivateLowConfidencePatterns,
} from "@ai-cofounder/db";

const logger = createLogger("pattern-feedback");

/**
 * Daily processor that adjusts pattern confidence based on acceptance rates.
 * Patterns that consistently get ignored lose confidence and eventually deactivate.
 * Patterns with high acceptance rates gain confidence.
 */
export class PatternFeedbackProcessor {
  constructor(private db: Db) {}

  async processConfidenceAdjustments() {
    const patterns = await listPatterns(this.db, { includeInactive: false });

    let adjusted = 0;

    for (const p of patterns) {
      if (p.hitCount < 5) continue;

      const acceptRate = p.hitCount > 0 ? (p.acceptCount / p.hitCount) * 100 : 0;
      let delta = 0;

      if (p.hitCount >= 10 && acceptRate >= 70) {
        delta = 5;
      } else if (p.hitCount >= 5 && acceptRate >= 50) {
        delta = 3;
      } else if (p.hitCount >= 5 && acceptRate < 10) {
        delta = -10;
      } else if (p.hitCount >= 5 && acceptRate < 25) {
        delta = -5;
      }

      if (delta !== 0) {
        try {
          await adjustPatternConfidence(this.db, p.id, delta);
          adjusted++;
          logger.debug(
            { patternId: p.id, delta, acceptRate: acceptRate.toFixed(1) },
            "adjusted pattern confidence",
          );
        } catch (err) {
          logger.warn({ err, patternId: p.id }, "failed to adjust pattern confidence");
        }
      }
    }

    // Deactivate patterns that dropped below threshold
    const deactivated = await deactivateLowConfidencePatterns(this.db);

    logger.info(
      { adjusted, deactivated, total: patterns.length },
      "pattern feedback processing complete",
    );

    return { adjusted, deactivated };
  }
}
