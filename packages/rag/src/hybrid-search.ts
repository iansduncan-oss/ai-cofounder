/**
 * Hybrid search: combines vector similarity (pgvector) and BM25 full-text search
 * using Reciprocal Rank Fusion (RRF) for score merging.
 */

import type { Db } from "@ai-cofounder/db";
import { searchChunksByVector, searchChunksByText } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import type { EmbedFn, RetrievalOptions } from "./retriever.js";

const logger = createLogger("rag-hybrid-search");

export interface HybridSearchOptions extends RetrievalOptions {
  vectorWeight?: number;
  textWeight?: number;
  rrfK?: number;
  candidateLimit?: number;
}

export interface HybridCandidate {
  id: string;
  content: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown> | null;
  chunkIndex: number;
  tokenCount: number;
  createdAt: Date;
  score: number;
}

/**
 * Pure RRF score computation.
 * Formula: score(doc) = sum(weight_i / (K + rank_i)) for each list the doc appears in.
 */
export function computeRRF(
  vectorResults: Array<{ id: string }>,
  textResults: Array<{ id: string }>,
  vectorWeight = 0.6,
  textWeight = 0.4,
  K = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (let i = 0; i < vectorResults.length; i++) {
    const id = vectorResults[i].id;
    const rank = i + 1;
    scores.set(id, (scores.get(id) ?? 0) + vectorWeight / (K + rank));
  }

  for (let i = 0; i < textResults.length; i++) {
    const id = textResults[i].id;
    const rank = i + 1;
    scores.set(id, (scores.get(id) ?? 0) + textWeight / (K + rank));
  }

  return scores;
}

/**
 * Run vector + BM25 searches in parallel, fuse with RRF, return merged candidates.
 * Falls back to text-only if embedding fails.
 */
export async function hybridSearch(
  db: Db,
  embed: EmbedFn,
  query: string,
  options?: HybridSearchOptions,
): Promise<HybridCandidate[]> {
  const candidateLimit = options?.candidateLimit ?? 40;
  const vectorWeight = options?.vectorWeight ?? 0.6;
  const textWeight = options?.textWeight ?? 0.4;
  const rrfK = options?.rrfK ?? 60;
  const limit = options?.limit ?? 10;

  // Run both searches in parallel — vector may fail (no embedding service, etc.)
  const [vectorResults, textResults] = await Promise.all([
    (async () => {
      try {
        const embedding = await embed(query);
        return await searchChunksByVector(db, embedding, {
          limit: candidateLimit,
          sourceType: options?.sourceType,
          sourceId: options?.sourceId,
        });
      } catch (err) {
        logger.warn({ err }, "Vector search failed, falling back to text-only");
        return [];
      }
    })(),
    searchChunksByText(db, query, {
      limit: candidateLimit,
      sourceType: options?.sourceType,
      sourceId: options?.sourceId,
    }),
  ]);

  if (vectorResults.length === 0 && textResults.length === 0) return [];

  // Compute RRF scores
  const rrfScores = computeRRF(vectorResults, textResults, vectorWeight, textWeight, rrfK);

  // Build candidate map from both result sets, deduplicating by id
  const candidateMap = new Map<string, HybridCandidate>();

  for (const row of vectorResults) {
    if (!candidateMap.has(row.id)) {
      candidateMap.set(row.id, {
        id: row.id,
        content: row.content,
        sourceType: row.source_type,
        sourceId: row.source_id,
        metadata: row.metadata,
        chunkIndex: row.chunk_index,
        tokenCount: row.token_count,
        createdAt: row.created_at,
        score: rrfScores.get(row.id) ?? 0,
      });
    }
  }

  for (const row of textResults) {
    if (!candidateMap.has(row.id)) {
      candidateMap.set(row.id, {
        id: row.id,
        content: row.content,
        sourceType: row.source_type,
        sourceId: row.source_id,
        metadata: row.metadata,
        chunkIndex: row.chunk_index,
        tokenCount: row.token_count,
        createdAt: row.created_at,
        score: rrfScores.get(row.id) ?? 0,
      });
    } else {
      // Update score for duplicates (already have data from vector results)
      candidateMap.get(row.id)!.score = rrfScores.get(row.id) ?? 0;
    }
  }

  // Sort by RRF score descending, take top N
  const sorted = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);

  logger.debug(
    {
      query: query.slice(0, 80),
      vectorHits: vectorResults.length,
      textHits: textResults.length,
      merged: sorted.length,
      returned: Math.min(sorted.length, limit),
    },
    "Hybrid search complete",
  );

  return sorted.slice(0, limit);
}
