import type { FastifyInstance } from "fastify";
import { optionalEnv } from "@ai-cofounder/shared";
import { enqueueRagIngestion } from "@ai-cofounder/queue";
import {
  getChunkCount,
  listIngestionStates,
} from "@ai-cofounder/db";

export async function ragRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // GET /api/rag/status — overview of RAG system
  app.get("/status", async () => {
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
  app.post<{
    Body: {
      action: "ingest_repo" | "ingest_conversations" | "ingest_text";
      sourceId: string;
      cursor?: string;
      content?: string;
    };
  }>("/ingest", async (request, reply) => {
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
  });

  // GET /api/rag/chunks/count — count chunks by source type
  app.get<{
    Querystring: { sourceType?: string };
  }>("/chunks/count", async (request) => {
    const sourceType = request.query.sourceType as "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown" | undefined;
    const count = await getChunkCount(app.db, sourceType);
    return { count, sourceType: sourceType ?? "all" };
  });
}
