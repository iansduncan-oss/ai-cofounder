CREATE TABLE IF NOT EXISTS "meeting_preps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" text NOT NULL UNIQUE,
  "event_title" text NOT NULL,
  "event_start" timestamptz NOT NULL,
  "prep_text" text NOT NULL,
  "attendees" jsonb,
  "related_memories" jsonb,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "notified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
