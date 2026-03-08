/**
 * RAG retriever: embed query → pgvector similarity search → rerank → format context.
 */

import type { Db } from "@ai-cofounder/db";
import { searchChunksByVector } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("rag-retriever");

export interface EmbedFn {
  (text: string): Promise<number[]>;
}

export interface RetrievalOptions {
  limit?: number;
  sourceType?: "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown";
  sourceId?: string;
  minScore?: number;
  diversifySources?: boolean;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  sourceType: string;
  sourceId: string;
  distance: number;
  score: number;
  metadata: Record<string, unknown> | null;
  tokenCount: number;
}

/**
 * Retrieve relevant chunks for a query string.
 * Flow: embed query → pgvector top-N → rerank → return top-K.
 */
export async function retrieve(
  db: Db,
  embed: EmbedFn,
  query: string,
  options?: RetrievalOptions,
): Promise<RetrievedChunk[]> {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0.3;
  const diversify = options?.diversifySources ?? true;

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(query);
  } catch (err) {
    logger.warn({ err }, "Failed to embed query for RAG retrieval");
    return [];
  }

  // Fetch more candidates than needed for reranking
  const candidateLimit = Math.max(limit * 4, 20);
  const candidates = await searchChunksByVector(db, queryEmbedding, {
    limit: candidateLimit,
    sourceType: options?.sourceType,
    sourceId: options?.sourceId,
  });

  if (candidates.length === 0) return [];

  // Convert distance to similarity score (cosine distance → similarity)
  const scored = candidates.map((c) => ({
    id: c.id,
    content: c.content,
    sourceType: c.source_type,
    sourceId: c.source_id,
    distance: c.distance,
    score: 1 - c.distance, // cosine distance to similarity
    metadata: c.metadata,
    tokenCount: c.token_count,
    createdAt: c.created_at,
  }));

  // Filter by minimum score
  const filtered = scored.filter((c) => c.score >= minScore);

  if (filtered.length === 0) return [];

  // Rerank: combine similarity score with recency bonus
  const now = Date.now();
  const reranked = filtered.map((c) => {
    const ageMs = now - new Date(c.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Recency bonus: full bonus for <1 day, decays over 30 days
    const recencyBonus = Math.max(0, 0.1 * (1 - ageDays / 30));
    return {
      ...c,
      finalScore: c.score + recencyBonus,
    };
  });

  reranked.sort((a, b) => b.finalScore - a.finalScore);

  // Source diversity: ensure we don't return all chunks from the same source
  let results: typeof reranked;
  if (diversify && reranked.length > limit) {
    results = diversifyResults(reranked, limit);
  } else {
    results = reranked.slice(0, limit);
  }

  logger.debug(
    {
      query: query.slice(0, 80),
      candidates: candidates.length,
      filtered: filtered.length,
      returned: results.length,
    },
    "RAG retrieval complete",
  );

  return results.map(({ createdAt: _createdAt, finalScore: _finalScore, ...rest }) => rest);
}

/**
 * Maximal Marginal Relevance-inspired diversification.
 * Ensures results come from diverse sources rather than all from the same file.
 */
function diversifyResults<T extends { sourceId: string; finalScore: number }>(
  ranked: T[],
  limit: number,
): T[] {
  const selected: T[] = [];
  const sourceCount = new Map<string, number>();

  for (const item of ranked) {
    if (selected.length >= limit) break;

    const count = sourceCount.get(item.sourceId) ?? 0;
    // Allow max 2 chunks from the same source in top results
    if (count >= 2) continue;

    selected.push(item);
    sourceCount.set(item.sourceId, count + 1);
  }

  // If we didn't fill the limit due to diversity constraints, add remaining
  if (selected.length < limit) {
    const selectedIds = new Set(selected.map((s) => s.sourceId + s.finalScore));
    for (const item of ranked) {
      if (selected.length >= limit) break;
      const key = item.sourceId + item.finalScore;
      if (!selectedIds.has(key)) {
        selected.push(item);
      }
    }
  }

  return selected;
}

/**
 * Format retrieved chunks as a context string for injection into agent prompts.
 */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  const lines: string[] = ["Retrieved context:"];
  for (const chunk of chunks) {
    const source = chunk.metadata?.filePath ?? chunk.sourceId;
    const score = (chunk.score * 100).toFixed(0);
    lines.push(`--- [${chunk.sourceType}] ${source} (${score}% match) ---`);
    lines.push(chunk.content);
    lines.push("");
  }

  return lines.join("\n");
}
