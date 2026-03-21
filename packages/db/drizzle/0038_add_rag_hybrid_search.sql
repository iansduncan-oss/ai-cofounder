-- Hybrid RAG search: BM25 full-text + contextual retrieval columns
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS context_prefix text;

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_document_chunks_search_vector ON document_chunks USING GIN(search_vector);

-- Auto-populate search_vector on insert/update
CREATE OR REPLACE FUNCTION document_chunks_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.context_prefix, '') || ' ' || NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_chunks_search_vector ON document_chunks;
CREATE TRIGGER trg_document_chunks_search_vector
  BEFORE INSERT OR UPDATE OF content, context_prefix ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_search_vector_trigger();

-- Backfill existing rows
UPDATE document_chunks SET search_vector = to_tsvector('english', content) WHERE search_vector IS NULL;
