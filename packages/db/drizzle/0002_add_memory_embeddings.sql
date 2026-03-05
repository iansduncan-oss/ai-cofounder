CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "memories" ADD COLUMN "embedding" vector(768);

CREATE INDEX "memories_embedding_idx" ON "memories"
  USING hnsw ("embedding" vector_cosine_ops);
