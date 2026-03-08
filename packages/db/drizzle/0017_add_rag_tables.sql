-- RAG document chunks and ingestion state tables

DO $$ BEGIN
  CREATE TYPE "source_type" AS ENUM ('git', 'conversation', 'slack', 'memory', 'reflection', 'markdown');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" "source_type" NOT NULL,
  "source_id" text NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(768),
  "metadata" jsonb,
  "chunk_index" integer NOT NULL,
  "token_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ingestion_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" "source_type" NOT NULL,
  "source_id" text NOT NULL,
  "last_ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_cursor" text,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  UNIQUE("source_type", "source_id")
);

-- HNSW index for fast cosine similarity search on embeddings
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- B-tree indexes for filtered queries
CREATE INDEX IF NOT EXISTS idx_document_chunks_source
  ON document_chunks (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_source_type
  ON document_chunks (source_type);
