/**
 * Contextualizer: generates a short context prefix for each chunk to improve
 * both embedding quality and BM25 relevance.
 */

import type { LlmRegistry } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import type { Chunk } from "./chunker.js";

const logger = createLogger("rag-contextualizer");

export interface ContextualizeOptions {
  enabled?: boolean;
  batchSize?: number;
}

export interface ContextualizedChunk extends Chunk {
  contextPrefix: string;
}

/**
 * Generate a 1-sentence context prefix for each chunk via a cheap LLM.
 * Batches concurrent LLM calls to control parallelism.
 */
export async function contextualizeChunks(
  registry: LlmRegistry,
  chunks: Chunk[],
  options?: ContextualizeOptions,
): Promise<ContextualizedChunk[]> {
  const enabled = options?.enabled ?? true;
  const batchSize = options?.batchSize ?? 5;

  if (!enabled || chunks.length === 0) {
    return chunks.map((c) => ({ ...c, contextPrefix: "" }));
  }

  const results: ContextualizedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const sourceName = chunk.metadata?.filePath ?? "a document";
          const prompt = `Given this text chunk from ${sourceName}, write a single sentence (under 30 words) that describes what this chunk is about and its context within the document. Start with "This chunk".

Chunk:
${chunk.content.slice(0, 800)}

Respond with ONLY the single context sentence, nothing else.`;

          const response = await registry.complete("simple", {
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 100,
          });

          const text = response.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();

          return { ...chunk, contextPrefix: text };
        } catch (err) {
          logger.warn(
            { err, chunkIndex: chunk.index },
            "Failed to contextualize chunk, using empty prefix",
          );
          return { ...chunk, contextPrefix: "" };
        }
      }),
    );
    results.push(...batchResults);
  }

  logger.debug(
    {
      total: chunks.length,
      contextualized: results.filter((r) => r.contextPrefix !== "").length,
    },
    "Contextualization complete",
  );

  return results;
}
