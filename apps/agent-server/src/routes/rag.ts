import type { FastifyInstance } from "fastify";
import { optionalEnv } from "@ai-cofounder/shared";
import { enqueueRagIngestion } from "@ai-cofounder/queue";
import {
  getChunkCount,
  listIngestionStates,
  deleteChunksBySource,
} from "@ai-cofounder/db";
import { retrieve } from "@ai-cofounder/rag";
import { RagIngestBody, RagSearchBody, RagChunkCountQuery, RagDeleteSourceParams } from "../schemas.js";

export async function ragRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // GET /api/rag/status — overview of RAG system
  app.get("/status", { schema: { tags: ["rag"] } }, async () => {
    const [totalChunks, ingestionStates] = await Promise.all([
      getChunkCount(app.db),
      listIngestionStates(app.db),
    ]);

    return {
      totalChunks,
      sources: ingestionStates.map((s) => ({
        type: s.sourceType,
        id: s.sourceId,
        lastIngested: s.lastIngestedAt,
        chunkCount: s.chunkCount,
        cursor: s.lastCursor,
      })),
    };
  });

  // POST /api/rag/ingest — trigger ingestion job
  app.post<{ Body: typeof RagIngestBody.static }>(
    "/ingest",
    { schema: { tags: ["rag"], body: RagIngestBody } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }

      const { action, sourceId, cursor, content } = request.body;
      const jobId = await enqueueRagIngestion({
        action,
        sourceId,
        cursor,
        metadata: content ? { content } : undefined,
      });

      return { jobId, action, sourceId };
    },
  );

  // GET /api/rag/chunks/count — count chunks by source type
  app.get<{ Querystring: typeof RagChunkCountQuery.static }>(
    "/chunks/count",
    { schema: { tags: ["rag"], querystring: RagChunkCountQuery } },
    async (request) => {
      const sourceType = request.query.sourceType as "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown" | undefined;
      const count = await getChunkCount(app.db, sourceType);
      return { count, sourceType: sourceType ?? "all" };
    },
  );

  // POST /api/rag/search — semantic search over RAG chunks
  app.post<{ Body: typeof RagSearchBody.static }>(
    "/search",
    { schema: { tags: ["rag"], body: RagSearchBody } },
    async (request, reply) => {
      if (!app.embeddingService) {
        return reply.status(503).send({ error: "Embedding service not available" });
      }

      const { query, limit, sourceType, minScore } = request.body;
      const results = await retrieve(
        app.db,
        app.embeddingService.embed.bind(app.embeddingService),
        query,
        {
          limit,
          sourceType: sourceType as "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown" | undefined,
          minScore,
        },
      );

      return { results, query };
    },
  );

  // DELETE /api/rag/sources/:sourceType/:sourceId — delete all chunks for a source
  app.delete<{ Params: typeof RagDeleteSourceParams.static }>(
    "/sources/:sourceType/:sourceId",
    { schema: { tags: ["rag"], params: RagDeleteSourceParams } },
    async (request) => {
      const { sourceType, sourceId } = request.params;
      await deleteChunksBySource(
        app.db,
        sourceType as "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown",
        sourceId,
      );
      return { deleted: true, sourceType, sourceId };
    },
  );
}
