/**
 * Failure Pattern Service: tracks tool errors and resolutions for self-improvement.
 * Records failures, identifies patterns, and formats known issues for agent prompts.
 */

import type { Db } from "@ai-cofounder/db";
import {
  upsertFailurePattern,
  getFailurePatternsForTool,
  listFailurePatterns,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("failure-patterns");

export class FailurePatternService {
  constructor(private db: Db) {}

  /**
   * Categorize and record a tool failure.
   */
  async recordFailure(
    toolName: string,
    error: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const category = this.categorizeError(error);

    try {
      await upsertFailurePattern(this.db, {
        toolName,
        errorCategory: category,
        errorMessage: error.slice(0, 1000),
        context,
      });
      logger.debug({ toolName, category }, "Recorded failure pattern");
    } catch (err) {
      logger.warn({ err, toolName }, "Failed to record failure pattern");
    }
  }

  /**
   * Get failure patterns for a specific tool.
   */
  async findPatterns(toolName: string): Promise<Array<{
    errorCategory: string;
    errorMessage: string;
    resolution: string | null;
    frequency: number;
  }>> {
    const patterns = await getFailurePatternsForTool(this.db, toolName, 5);
    return patterns.map((p) => ({
      errorCategory: p.errorCategory,
      errorMessage: p.errorMessage,
      resolution: p.resolution,
      frequency: p.frequency,
    }));
  }

  /**
   * Format top failure patterns as a section for agent system prompts.
   */
  async formatPatternsForPrompt(): Promise<string> {
    const patterns = await listFailurePatterns(this.db, 10);
    if (patterns.length === 0) return "";

    const top = patterns.filter((p) => p.frequency >= 2).slice(0, 5);
    if (top.length === 0) return "";

    const lines = ["## Known issues and solutions"];
    for (const p of top) {
      const resolution = p.resolution ? ` → Fix: ${p.resolution}` : "";
      lines.push(`- **${p.toolName}** (${p.errorCategory}, ${p.frequency}x): ${p.errorMessage.slice(0, 150)}${resolution}`);
    }
    return lines.join("\n");
  }

  /**
   * Record a resolution for a known failure pattern.
   */
  async recordResolution(toolName: string, errorCategory: string, resolution: string): Promise<void> {
    await upsertFailurePattern(this.db, {
      toolName,
      errorCategory,
      errorMessage: "", // Won't overwrite existing
      resolution,
    });
  }

  private categorizeError(error: string): string {
    const lower = error.toLowerCase();

    if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
    if (lower.includes("econnrefused") || lower.includes("econnreset")) return "connection";
    if (lower.includes("rate limit") || lower.includes("429")) return "rate_limit";
    if (lower.includes("permission") || lower.includes("403") || lower.includes("unauthorized")) return "permission";
    if (lower.includes("not found") || lower.includes("404")) return "not_found";
    if (lower.includes("invalid") || lower.includes("validation")) return "validation";
    if (lower.includes("parse") || lower.includes("syntax") || lower.includes("json")) return "parse_error";
    if (lower.includes("out of memory") || lower.includes("oom")) return "resource";
    if (lower.includes("500") || lower.includes("internal server")) return "server_error";

    return "unknown";
  }
}
