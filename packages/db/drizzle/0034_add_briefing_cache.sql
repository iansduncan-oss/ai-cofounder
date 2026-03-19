-- Briefing cache: stores generated daily briefings for quick retrieval
CREATE TABLE IF NOT EXISTS "briefing_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "date" text NOT NULL UNIQUE,
  "briefing_text" text NOT NULL,
  "sections" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
