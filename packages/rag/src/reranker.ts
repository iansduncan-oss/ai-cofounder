/**
 * LLM-based reranker: scores candidate chunks against a query using a cheap LLM.
 */

import type { LlmRegistry } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import type { HybridCandidate } from "./hybrid-search.js";

const logger = createLogger("rag-reranker");

export interface RerankOptions {
  enabled?: boolean;
  topK?: number;
  taskCategory?: "simple" | "conversation" | "research";
}

export interface RankedChunk extends HybridCandidate {
  rerankScore: number;
}

/**
 * Rerank candidates by scoring each one against the query via a cheap LLM call.
 * On any error, returns candidates sorted by their existing RRF score.
 */
export async function rerank(
  registry: LlmRegistry,
  query: string,
  candidates: HybridCandidate[],
  options?: RerankOptions,
): Promise<RankedChunk[]> {
  const enabled = options?.enabled ?? true;
  const topK = options?.topK ?? 5;

  if (!enabled || candidates.length === 0) {
    return candidates.slice(0, topK).map((c) => ({ ...c, rerankScore: c.score }));
  }

  // Cap at 30 candidates to control token usage
  const capped = candidates.slice(0, 30);

  const chunkSummaries = capped
    .map((c, i) => `[${i}] ${c.content.slice(0, 500)}`)
    .join("\n\n");

  const prompt = `You are a relevance scorer. Given a query and a list of text chunks, score each chunk's relevance to the query on a scale of 0-10 (10 = perfectly relevant, 0 = irrelevant).

Query: "${query}"

Chunks:
${chunkSummaries}

Respond ONLY with a JSON array of objects: [{"index": 0, "score": 7}, ...]. Include ALL chunks. No explanation.`;

  try {
    const response = await registry.complete("simple", {
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 1024,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Extract JSON array from response (may have markdown fences)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn("Reranker: no JSON array found in LLM response, falling back to RRF scores");
      return capped.slice(0, topK).map((c) => ({ ...c, rerankScore: c.score }));
    }

    const scores: Array<{ index: number; score: number }> = JSON.parse(jsonMatch[0]);

    // Merge LLM scores with candidates
    const ranked: RankedChunk[] = capped.map((c, i) => {
      const llmScore = scores.find((s) => s.index === i)?.score ?? 0;
      return { ...c, rerankScore: llmScore };
    });

    ranked.sort((a, b) => b.rerankScore - a.rerankScore);

    return ranked.slice(0, topK);
  } catch (err) {
    logger.warn({ err }, "Reranker LLM call failed, falling back to RRF scores");
    return capped.slice(0, topK).map((c) => ({ ...c, rerankScore: c.score }));
  }
}
