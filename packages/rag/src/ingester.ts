/**
 * RAG ingestion pipeline: source → chunk → embed → store.
 * Supports incremental ingestion via cursor tracking.
 */

import type { Db } from "@ai-cofounder/db";
import {
  insertChunks,
  deleteChunksBySource,
  upsertIngestionState,
  getIngestionState,
  type ChunkInsert,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { chunkText, type ChunkerOptions } from "./chunker.js";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { contextualizeChunks } from "./contextualizer.js";
import type { EmbedFn } from "./retriever.js";

const logger = createLogger("rag-ingester");

type SourceType = "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown";

export interface FileToIngest {
  path: string;
  content: string;
  language?: string;
}

export interface IngestionResult {
  sourceType: SourceType;
  sourceId: string;
  chunksCreated: number;
  chunksEmbedded: number;
  skipped: boolean;
}

// Files to skip during ingestion
const IGNORE_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /\.turbo\//,
  /\.next\//,
  /\.env/,
  /\.pem$/,
  /\.key$/,
  /\.lock$/,
  /package-lock\.json$/,
  /\.min\.js$/,
  /\.map$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.ico$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.webp$/,
  /\.mp[34]$/,
  /\.wav$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar/,
  /\.gz$/,
];

export function shouldSkipFile(path: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Embed chunks in batches to avoid overwhelming the embedding API.
 */
async function embedBatch(
  texts: string[],
  embed: EmbedFn,
  batchSize = 10,
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(
      batch.map(async (text) => {
        try {
          return await embed(text);
        } catch (err) {
          logger.warn({ err, textLength: text.length }, "Failed to embed chunk");
          return null;
        }
      }),
    );
    results.push(...embeddings);
  }

  return results;
}

/**
 * Ingest a set of files from a single source (e.g., a git repo).
 * Replaces all existing chunks for this source.
 */
export async function ingestFiles(
  db: Db,
  embed: EmbedFn,
  sourceType: SourceType,
  sourceId: string,
  files: FileToIngest[],
  options?: {
    cursor?: string;
    chunkerOptions?: ChunkerOptions;
    contextualize?: boolean;
    llmRegistry?: LlmRegistry;
  },
): Promise<IngestionResult> {
  const filteredFiles = files.filter((f) => !shouldSkipFile(f.path));

  if (filteredFiles.length === 0) {
    logger.info({ sourceType, sourceId }, "No files to ingest after filtering");
    return { sourceType, sourceId, chunksCreated: 0, chunksEmbedded: 0, skipped: true };
  }

  logger.info(
    { sourceType, sourceId, fileCount: filteredFiles.length },
    "Starting file ingestion",
  );

  // Delete existing chunks for this source (full re-ingest)
  await deleteChunksBySource(db, sourceType, sourceId);

  // Chunk all files
  const allChunks: ChunkInsert[] = [];
  const chunkTexts: string[] = [];

  for (const file of filteredFiles) {
    const chunks = chunkText(file.content, {
      ...options?.chunkerOptions,
      filePath: file.path,
      language: file.language,
    });

    for (const chunk of chunks) {
      allChunks.push({
        sourceType,
        sourceId,
        content: chunk.content,
        metadata: chunk.metadata as Record<string, unknown>,
        chunkIndex: chunk.index,
        tokenCount: chunk.tokenCount,
      });
      chunkTexts.push(chunk.content);
    }
  }

  // Optional contextualization: generate context prefixes for better retrieval
  if (options?.contextualize && options.llmRegistry) {
    try {
      const rawChunks = allChunks.map((c) => ({
        content: c.content,
        index: c.chunkIndex,
        tokenCount: c.tokenCount,
        metadata: { type: "prose" as const, ...(c.metadata as Record<string, unknown> ?? {}) },
        startLine: 0,
        endLine: 0,
      }));
      const contextualized = await contextualizeChunks(options.llmRegistry, rawChunks);
      for (let i = 0; i < contextualized.length && i < allChunks.length; i++) {
        if (contextualized[i].contextPrefix) {
          allChunks[i].contextPrefix = contextualized[i].contextPrefix;
          chunkTexts[i] = `${contextualized[i].contextPrefix}\n\n${allChunks[i].content}`;
        }
      }
    } catch (err) {
      logger.warn({ err }, "Contextualization failed, proceeding without context prefixes");
    }
  }

  // Embed all chunks
  const embeddings = await embedBatch(chunkTexts, embed);

  let embeddedCount = 0;
  for (let i = 0; i < allChunks.length; i++) {
    if (embeddings[i]) {
      allChunks[i].embedding = embeddings[i]!;
      embeddedCount++;
    }
  }

  // Insert in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    await insertChunks(db, batch);
  }

  // Update ingestion state
  await upsertIngestionState(db, {
    sourceType,
    sourceId,
    lastCursor: options?.cursor,
    chunkCount: allChunks.length,
  });

  logger.info(
    {
      sourceType,
      sourceId,
      chunks: allChunks.length,
      embedded: embeddedCount,
    },
    "Ingestion complete",
  );

  return {
    sourceType,
    sourceId,
    chunksCreated: allChunks.length,
    chunksEmbedded: embeddedCount,
    skipped: false,
  };
}

/**
 * Ingest a single text document (e.g., a conversation summary, markdown doc).
 */
export async function ingestText(
  db: Db,
  embed: EmbedFn,
  sourceType: SourceType,
  sourceId: string,
  content: string,
  options?: {
    cursor?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<IngestionResult> {
  const chunks = chunkText(content, { filePath: sourceId });

  // Delete existing chunks for this source
  await deleteChunksBySource(db, sourceType, sourceId);

  const chunkInserts: ChunkInsert[] = [];
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedBatch(texts, embed);

  let embeddedCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const insert: ChunkInsert = {
      sourceType,
      sourceId,
      content: chunks[i].content,
      metadata: {
        ...chunks[i].metadata,
        ...options?.metadata,
      } as Record<string, unknown>,
      chunkIndex: chunks[i].index,
      tokenCount: chunks[i].tokenCount,
    };
    if (embeddings[i]) {
      insert.embedding = embeddings[i]!;
      embeddedCount++;
    }
    chunkInserts.push(insert);
  }

  if (chunkInserts.length > 0) {
    await insertChunks(db, chunkInserts);
  }

  await upsertIngestionState(db, {
    sourceType,
    sourceId,
    lastCursor: options?.cursor,
    chunkCount: chunkInserts.length,
  });

  return {
    sourceType,
    sourceId,
    chunksCreated: chunkInserts.length,
    chunksEmbedded: embeddedCount,
    skipped: false,
  };
}

/**
 * Check if a source needs re-ingestion based on cursor comparison.
 */
export async function needsReingestion(
  db: Db,
  sourceType: SourceType,
  sourceId: string,
  currentCursor: string,
): Promise<boolean> {
  const state = await getIngestionState(db, sourceType, sourceId);
  if (!state) return true; // never ingested
  return state.lastCursor !== currentCursor;
}
