/**
 * RAG retriever: embed query → hybrid search (vector + BM25) → rerank → format context.
 */

import type { Db } from "@ai-cofounder/db";
import { searchChunksByVector } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import { hybridSearch } from "./hybrid-search.js";
import { rerank } from "./reranker.js";

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
  llmRegistry?: LlmRegistry;
  enableReranking?: boolean;
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
 * Delegates to hybrid search (vector + BM25) by default, with vector-only fallback.
 * Optionally applies LLM reranking when llmRegistry + enableReranking are provided.
 */
export async function retrieve(
  db: Db,
  embed: EmbedFn,
  query: string,
  options?: RetrievalOptions,
): Promise<RetrievedChunk[]> {
  const limit = options?.limit ?? 5;
  const doRerank = options?.enableReranking && options?.llmRegistry;

  // Fetch extra candidates if reranking is enabled
  const fetchLimit = doRerank ? Math.max(limit * 3, 15) : limit;

  // Delegate to hybrid search (vector + BM25 via RRF)
  const candidates = await hybridSearch(db, embed, query, {
    ...options,
    limit: fetchLimit,
  });

  // Convert to RetrievedChunk format
  let results: RetrievedChunk[];

  if (doRerank && candidates.length > 0) {
    try {
      const ranked = await rerank(options!.llmRegistry!, query, candidates, { topK: limit });
      results = ranked.map((c) => ({
        id: c.id,
        content: c.content,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        distance: 0,
        score: c.rerankScore / 10, // Normalize 0-10 to 0-1
        metadata: c.metadata,
        tokenCount: c.tokenCount,
      }));
    } catch (err) {
      logger.warn({ err }, "Reranking failed, using hybrid order");
      results = candidates.slice(0, limit).map((c) => ({
        id: c.id,
        content: c.content,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        distance: 0,
        score: c.score,
        metadata: c.metadata,
        tokenCount: c.tokenCount,
      }));
    }
  } else {
    results = candidates.slice(0, limit).map((c) => ({
      id: c.id,
      content: c.content,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      distance: 0,
      score: c.score,
      metadata: c.metadata,
      tokenCount: c.tokenCount,
    }));
  }

  logger.debug(
    {
      query: query.slice(0, 80),
      returned: results.length,
      reranked: !!doRerank,
    },
    "RAG retrieval complete",
  );

  return results;
}

/**
 * Pure vector-only retrieval (legacy path).
 * Use `retrieve()` for the default hybrid path.
 */
export async function retrieveVectorOnly(
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

  const candidateLimit = Math.max(limit * 4, 20);
  const candidates = await searchChunksByVector(db, queryEmbedding, {
    limit: candidateLimit,
    sourceType: options?.sourceType,
    sourceId: options?.sourceId,
  });

  if (candidates.length === 0) return [];

  const scored = candidates.map((c) => ({
    id: c.id,
    content: c.content,
    sourceType: c.source_type,
    sourceId: c.source_id,
    distance: c.distance,
    score: 1 - c.distance,
    metadata: c.metadata,
    tokenCount: c.token_count,
    createdAt: c.created_at,
  }));

  const filtered = scored.filter((c) => c.score >= minScore);
  if (filtered.length === 0) return [];

  const now = Date.now();
  const reranked = filtered.map((c) => {
    const ageMs = now - new Date(c.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 0.1 * (1 - ageDays / 30));
    return { ...c, finalScore: c.score + recencyBonus };
  });

  reranked.sort((a, b) => b.finalScore - a.finalScore);

  let results: typeof reranked;
  if (diversify && reranked.length > limit) {
    results = diversifyResults(reranked, limit);
  } else {
    results = reranked.slice(0, limit);
  }

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
    if (count >= 2) continue;

    selected.push(item);
    sourceCount.set(item.sourceId, count + 1);
  }

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
