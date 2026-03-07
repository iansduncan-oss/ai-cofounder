CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  summary TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  from_message_created_at TIMESTAMPTZ,
  to_message_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conv_summaries_conv_id ON conversation_summaries(conversation_id);
