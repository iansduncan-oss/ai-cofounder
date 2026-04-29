import {
  eq,
  and,
  desc,
  asc,
  ilike,
  or,
  sql,
  lte,
  gte,
  isNull,
  isNotNull,
  inArray,
  gt,
} from "drizzle-orm";
import type { Db } from "../client.js";

/** Coerce empty string to undefined for UUID columns */
function nullifyEmpty(val: string | undefined | null): string | undefined {
  return val ? val : undefined;
}
import {
  documentChunks,
  ingestionState,
} from "../schema.js";

/* ────────────────── RAG: Document Chunks ──────────────── */

type SourceType = "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown";

export interface ChunkInsert {
  sourceType: SourceType;
  sourceId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  chunkIndex: number;
  tokenCount: number;
  contextPrefix?: string;
}

export async function insertChunks(db: Db, chunks: ChunkInsert[]) {
  if (chunks.length === 0) return [];
  const rows = await db.insert(documentChunks).values(chunks).returning();
  return rows;
}

export async function searchChunksByVector(
  db: Db,
  embedding: number[],
  options?: {
    limit?: number;
    sourceType?: SourceType;
    sourceId?: string;
  },
) {
  const limit = options?.limit ?? 20;
  const vectorLiteral = `[${embedding.join(",")}]`;

  // Build parameterized WHERE clause — never interpolate user input into sql.raw()
  const validSourceTypes: SourceType[] = [
    "git",
    "conversation",
    "slack",
    "memory",
    "reflection",
    "markdown",
  ];
  let whereClause = sql`embedding IS NOT NULL`;
  if (options?.sourceType && validSourceTypes.includes(options.sourceType)) {
    whereClause = sql`${whereClause} AND source_type = ${options.sourceType}`;
  }
  if (options?.sourceId) {
    whereClause = sql`${whereClause} AND source_id = ${options.sourceId}`;
  }

  const rows = await db.execute(
    sql`SELECT id, source_type, source_id, content, metadata, chunk_index, token_count, created_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM document_chunks
        WHERE ${whereClause}
        ORDER BY distance ASC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    metadata: Record<string, unknown> | null;
    chunk_index: number;
    token_count: number;
    created_at: Date;
    distance: number;
  }>;
}

export async function deleteChunksBySource(db: Db, sourceType: SourceType, sourceId: string) {
  await db
    .delete(documentChunks)
    .where(and(eq(documentChunks.sourceType, sourceType), eq(documentChunks.sourceId, sourceId)));
}

export async function getChunkCount(db: Db, sourceType?: SourceType): Promise<number> {
  const conditions = sourceType ? [eq(documentChunks.sourceType, sourceType)] : [];
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentChunks)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return rows[0]?.count ?? 0;
}

/* ────────────────── RAG: Ingestion State ──────────────── */

export async function upsertIngestionState(
  db: Db,
  data: {
    sourceType: SourceType;
    sourceId: string;
    lastCursor?: string;
    chunkCount: number;
  },
) {
  const [result] = await db
    .insert(ingestionState)
    .values({
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      lastIngestedAt: new Date(),
      lastCursor: data.lastCursor,
      chunkCount: data.chunkCount,
    })
    .onConflictDoUpdate({
      target: [ingestionState.sourceType, ingestionState.sourceId],
      set: {
        lastIngestedAt: new Date(),
        lastCursor: data.lastCursor,
        chunkCount: data.chunkCount,
      },
    })
    .returning();
  return result;
}

export async function getIngestionState(db: Db, sourceType: SourceType, sourceId: string) {
  const rows = await db
    .select()
    .from(ingestionState)
    .where(and(eq(ingestionState.sourceType, sourceType), eq(ingestionState.sourceId, sourceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listIngestionStates(db: Db, sourceType?: SourceType) {
  if (sourceType) {
    return db
      .select()
      .from(ingestionState)
      .where(eq(ingestionState.sourceType, sourceType))
      .orderBy(desc(ingestionState.lastIngestedAt));
  }
  return db.select().from(ingestionState).orderBy(desc(ingestionState.lastIngestedAt));
}

/* ────────────────────── Hybrid RAG Search (BM25 + Vector) ────────────────────── */

export async function searchChunksByText(
  db: Db,
  query: string,
  options?: {
    limit?: number;
    sourceType?: SourceType;
    sourceId?: string;
  },
) {
  const limit = options?.limit ?? 20;
  const validSourceTypes: SourceType[] = [
    "git",
    "conversation",
    "slack",
    "memory",
    "reflection",
    "markdown",
  ];
  let whereClause = sql`search_vector IS NOT NULL`;
  if (options?.sourceType && validSourceTypes.includes(options.sourceType)) {
    whereClause = sql`${whereClause} AND source_type = ${options.sourceType}`;
  }
  if (options?.sourceId) {
    whereClause = sql`${whereClause} AND source_id = ${options.sourceId}`;
  }

  const rows = await db.execute(
    sql`SELECT id, source_type, source_id, content, metadata, chunk_index, token_count, created_at,
               ts_rank_cd(search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM document_chunks
        WHERE ${whereClause} AND search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    metadata: Record<string, unknown> | null;
    chunk_index: number;
    token_count: number;
    created_at: Date;
    rank: number;
  }>;
}

export async function hybridSearchChunks(
  db: Db,
  embedding: number[],
  queryText: string,
  options?: {
    limit?: number;
    sourceType?: SourceType;
    sourceId?: string;
    vectorWeight?: number;
    bm25Weight?: number;
  },
) {
  const limit = options?.limit ?? 20;
  const vectorWeight = options?.vectorWeight ?? 0.6;
  const bm25Weight = options?.bm25Weight ?? 0.4;
  const k = 60; // RRF constant
  const vectorLiteral = `[${embedding.join(",")}]`;

  const validSourceTypes: SourceType[] = [
    "git",
    "conversation",
    "slack",
    "memory",
    "reflection",
    "markdown",
  ];
  let whereClause = sql`embedding IS NOT NULL`;
  if (options?.sourceType && validSourceTypes.includes(options.sourceType)) {
    whereClause = sql`${whereClause} AND source_type = ${options.sourceType}`;
  }
  if (options?.sourceId) {
    whereClause = sql`${whereClause} AND source_id = ${options.sourceId}`;
  }

  // Reciprocal Rank Fusion (RRF) combining vector and BM25 results
  const rows = await db.execute(
    sql`WITH vector_ranked AS (
          SELECT id, content, source_type, source_id, metadata, chunk_index, token_count, created_at,
                 ROW_NUMBER() OVER (ORDER BY embedding <=> ${vectorLiteral}::vector ASC) AS vrank
          FROM document_chunks
          WHERE ${whereClause}
          LIMIT 100
        ),
        bm25_ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', ${queryText})) DESC) AS brank
          FROM document_chunks
          WHERE search_vector IS NOT NULL AND search_vector @@ plainto_tsquery('english', ${queryText})
          LIMIT 100
        )
        SELECT v.id, v.content, v.source_type, v.source_id, v.metadata, v.chunk_index, v.token_count, v.created_at,
               (${vectorWeight} / (${k} + v.vrank)) + COALESCE(${bm25Weight} / (${k} + b.brank), 0) AS rrf_score,
               v.vrank,
               b.brank
        FROM vector_ranked v
        LEFT JOIN bm25_ranked b ON v.id = b.id
        ORDER BY rrf_score DESC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    content: string;
    source_type: string;
    source_id: string;
    metadata: Record<string, unknown> | null;
    chunk_index: number;
    token_count: number;
    created_at: Date;
    rrf_score: number;
    vrank: number;
    brank: number | null;
  }>;
}

