import { createLogger } from "@ai-cofounder/shared";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { saveMemory, memories } from "@ai-cofounder/db";
import { eq, and, sql, desc } from "drizzle-orm";

const logger = createLogger("memory-consolidation");

// Minimum memories per user to attempt consolidation
const MIN_MEMORIES_FOR_CONSOLIDATION = 5;
// Minimum cluster size to create a composite memory
const MIN_CLUSTER_SIZE = 2;
// Maximum memories per user to fetch for consolidation
const MAX_MEMORIES_TO_FETCH = 100;
// Maximum char length per memory in the LLM prompt
const MEMORY_PROMPT_CHAR_LIMIT = 200;

interface ConsolidationCluster {
  title: string;
  summary: string;
  memberIds: string[];
}

interface MemoryRow {
  id: string;
  userId: string;
  category: string;
  key: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

export class MemoryConsolidationService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embeddingService?: EmbeddingService,
  ) {}

  /**
   * Run memory consolidation across all users.
   * Groups non-consolidated memories by category, clusters related ones,
   * and creates composite memories per user.
   *
   * Returns: { consolidated: totalMarked, created: totalNewComposites }
   */
  async consolidate(): Promise<{ consolidated: number; created: number }> {
    let totalConsolidated = 0;
    let totalCreated = 0;

    try {
      // Step 1: Get distinct userIds that have non-consolidated memories
      const userRows = await this.db
        .selectDistinct({ userId: memories.userId })
        .from(memories)
        .where(
          sql`${memories.metadata}->>'consolidated' IS NULL OR ${memories.metadata}->>'consolidated' != 'true'`,
        );

      logger.info({ userCount: userRows.length }, "memory consolidation: users to process");

      for (const { userId } of userRows) {
        try {
          const { consolidated, created } = await this.consolidateForUser(userId);
          totalConsolidated += consolidated;
          totalCreated += created;
        } catch (err) {
          logger.warn({ err, userId }, "memory consolidation failed for user (continuing)");
        }
      }
    } catch (err) {
      logger.warn({ err }, "memory consolidation failed (non-fatal)");
    }

    logger.info({ consolidated: totalConsolidated, created: totalCreated }, "memory consolidation complete");
    return { consolidated: totalConsolidated, created: totalCreated };
  }

  private async consolidateForUser(
    userId: string,
  ): Promise<{ consolidated: number; created: number }> {
    // Fetch non-consolidated memories for this user
    const userMemories = await this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          sql`${memories.metadata}->>'consolidated' IS NULL OR ${memories.metadata}->>'consolidated' != 'true'`,
        ),
      )
      .orderBy(desc(memories.createdAt))
      .limit(MAX_MEMORIES_TO_FETCH);

    if (userMemories.length < MIN_MEMORIES_FOR_CONSOLIDATION) {
      logger.debug({ userId, count: userMemories.length }, "skipping user: fewer than minimum memories");
      return { consolidated: 0, created: 0 };
    }

    // Group by category
    const byCategory = new Map<string, MemoryRow[]>();
    for (const mem of userMemories) {
      const cat = mem.category ?? "other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(mem as MemoryRow);
    }

    let consolidated = 0;
    let created = 0;

    // Process each category with enough members
    for (const [category, categoryMemories] of byCategory.entries()) {
      if (categoryMemories.length < 3) continue;

      try {
        const { consolidated: c, created: cr } = await this.consolidateCategory(
          userId,
          category,
          categoryMemories,
        );
        consolidated += c;
        created += cr;
      } catch (err) {
        logger.warn({ err, userId, category }, "category consolidation failed (continuing)");
      }
    }

    return { consolidated, created };
  }

  private async consolidateCategory(
    userId: string,
    category: string,
    categoryMemories: MemoryRow[],
  ): Promise<{ consolidated: number; created: number }> {
    // Build prompt listing memories in this category
    const memoryList = categoryMemories
      .map((m, i) => {
        const snippet = m.content.length > MEMORY_PROMPT_CHAR_LIMIT
          ? m.content.slice(0, MEMORY_PROMPT_CHAR_LIMIT)
          : m.content;
        return `${i + 1}. [ID: ${m.id}] "${m.key}": ${snippet}`;
      })
      .join("\n");

    const prompt = `You are consolidating memories in the "${category}" category.
Below are individual memory entries. Group them into clusters of related items.
For each cluster, provide a consolidated summary.
Only cluster items that are genuinely related.

Memories:
${memoryList}

Respond with ONLY valid JSON in this exact format:
{
  "clusters": [
    {
      "title": "Short cluster title (5-10 words)",
      "summary": "Consolidated summary of this cluster (2-4 sentences)",
      "memberIds": ["<id1>", "<id2>"]
    }
  ]
}

Rules:
- memberIds must be the exact ID strings from the list
- Each memory can only appear in one cluster
- Only create clusters with 2+ members
- Unrelated memories should NOT be clustered`;

    let clusters: ConsolidationCluster[] = [];

    try {
      const result = await this.llmRegistry.complete("simple", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
      });

      const text = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { consolidated: 0, created: 0 };

      const parsed = JSON.parse(jsonMatch[0]) as { clusters: ConsolidationCluster[] };
      clusters = parsed.clusters ?? [];
    } catch (err) {
      logger.warn({ err, userId, category }, "LLM clustering failed (non-fatal)");
      return { consolidated: 0, created: 0 };
    }

    let consolidated = 0;
    let created = 0;

    // Build a lookup map for member IDs
    const memoryById = new Map(categoryMemories.map((m) => [m.id, m]));

    for (const cluster of clusters) {
      if (!cluster.memberIds || cluster.memberIds.length < MIN_CLUSTER_SIZE) continue;

      // Validate all member IDs exist in this user's memories (security: per-user scoping)
      const validMembers = cluster.memberIds.filter((id) => memoryById.has(id));
      if (validMembers.length < MIN_CLUSTER_SIZE) continue;

      try {
        // Generate embedding for the composite memory
        let embedding: number[] | undefined;
        if (this.embeddingService) {
          try {
            embedding = await this.embeddingService.embed(cluster.summary);
          } catch {
            // Embedding failure is non-fatal
          }
        }

        // Save composite memory (userId is unambiguous from per-user iteration)
        const composite = await saveMemory(this.db, {
          userId,
          category: category as Parameters<typeof saveMemory>[1]["category"],
          key: cluster.title,
          content: cluster.summary,
          importance: 9,
          metadata: {
            consolidated_from: validMembers,
            consolidated_at: new Date().toISOString(),
          },
          embedding,
        });

        created++;
        logger.info({ userId, category, compositeId: composite.id, memberCount: validMembers.length }, "composite memory created");

        // Mark each constituent memory as consolidated
        for (const memberId of validMembers) {
          try {
            await this.db
              .update(memories)
              .set({
                metadata: sql`COALESCE(${memories.metadata}, '{}') || ${JSON.stringify({ consolidated: "true", consolidatedInto: composite.id })}::jsonb`,
              })
              .where(eq(memories.id, memberId));
            consolidated++;
          } catch (err) {
            logger.warn({ err, memberId }, "failed to mark memory as consolidated (non-fatal)");
          }
        }
      } catch (err) {
        logger.warn({ err, cluster: cluster.title }, "cluster save failed (non-fatal)");
      }
    }

    return { consolidated, created };
  }
}
