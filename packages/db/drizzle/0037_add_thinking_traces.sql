-- Thinking traces: store agent reasoning for debugging and transparency
CREATE TABLE IF NOT EXISTS thinking_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_id TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_thinking_traces_conversation ON thinking_traces(conversation_id);
CREATE INDEX idx_thinking_traces_request ON thinking_traces(request_id) WHERE request_id IS NOT NULL;
