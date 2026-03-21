/**
 * Memory Lifecycle Service: manages memory decay, archival, and budget enforcement.
 * Runs as a daily recurring job via the reflection queue.
 */

import type { Db } from "@ai-cofounder/db";
import {
  listMemoriesForDecay,
  archiveMemory,
  countActiveMemories,
} from "@ai-cofounder/db";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("memory-lifecycle");

export class MemoryLifecycleService {
  private decayRate: number;
  private archiveThreshold: number;
  private budgetPerUser: number;

  constructor(private db: Db) {
    this.decayRate = parseFloat(optionalEnv("MEMORY_DECAY_RATE", "0.05"));
    this.archiveThreshold = 0.1;
    this.budgetPerUser = parseInt(optionalEnv("MEMORY_BUDGET_PER_USER", "10000"), 10);
  }

  /**
   * Apply time-based decay to memory importance.
   * Formula: importance * exp(-decayRate * daysSinceAccess)
   */
  async runDecay(userId: string): Promise<{ decayed: number }> {
    const memories = await listMemoriesForDecay(this.db, userId, 500);
    const now = Date.now();
    let decayedCount = 0;

    for (const memory of memories) {
      const lastAccess = memory.lastAccessedAt ?? memory.createdAt;
      const daysSinceAccess = (now - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-this.decayRate * daysSinceAccess);
      const newImportance = Math.round(memory.importance * decayFactor);

      if (newImportance !== memory.importance) {
        // Update importance via raw update to avoid pulling in full ORM
        const { memories: memoriesTable } = await import("@ai-cofounder/db");
        const { eq } = await import("@ai-cofounder/db");
        await this.db.update(memoriesTable).set({ importance: newImportance }).where(eq(memoriesTable.id, memory.id));
        decayedCount++;
      }
    }

    logger.info({ userId, decayed: decayedCount, total: memories.length }, "Memory decay complete");
    return { decayed: decayedCount };
  }

  /**
   * Archive memories whose importance has dropped below threshold.
   */
  async archiveStale(userId: string): Promise<{ archived: number }> {
    const memories = await listMemoriesForDecay(this.db, userId, 500);
    const importanceThreshold = Math.round(this.archiveThreshold * 100); // 0-100 scale
    const stale = memories.filter((m) => m.importance <= importanceThreshold);

    for (const memory of stale) {
      await archiveMemory(this.db, memory.id);
    }

    if (stale.length > 0) {
      logger.info({ userId, archived: stale.length }, "Archived stale memories");
    }
    return { archived: stale.length };
  }

  /**
   * Enforce per-user memory budget by archiving lowest-importance memories.
   */
  async enforceBudget(userId: string): Promise<{ archived: number }> {
    const count = await countActiveMemories(this.db, userId);
    if (count <= this.budgetPerUser) return { archived: 0 };

    const excess = count - this.budgetPerUser;
    const memories = await listMemoriesForDecay(this.db, userId, excess + 50);

    // Sort by importance ascending (archive least important first)
    const sorted = [...memories].sort((a, b) => a.importance - b.importance);
    const toArchive = sorted.slice(0, excess);

    for (const memory of toArchive) {
      await archiveMemory(this.db, memory.id);
    }

    logger.info(
      { userId, count, budget: this.budgetPerUser, archived: toArchive.length },
      "Enforced memory budget",
    );
    return { archived: toArchive.length };
  }

  /**
   * Run all lifecycle operations for a user.
   */
  async runFullLifecycle(userId: string): Promise<{
    decayed: number;
    archived: number;
    budgetArchived: number;
  }> {
    const decay = await this.runDecay(userId);
    const stale = await this.archiveStale(userId);
    const budget = await this.enforceBudget(userId);
    return {
      decayed: decay.decayed,
      archived: stale.archived,
      budgetArchived: budget.archived,
    };
  }
}
