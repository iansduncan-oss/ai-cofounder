-- Add goal_id to work_sessions
ALTER TABLE "work_sessions" ADD COLUMN "goal_id" uuid REFERENCES "goals"("id") ON DELETE SET NULL;
CREATE INDEX "work_sessions_goal_id_idx" ON "work_sessions" ("goal_id");

-- Journal entry type enum
DO $$ BEGIN
  CREATE TYPE "journal_entry_type" AS ENUM (
    'goal_started', 'goal_completed', 'goal_failed',
    'task_completed', 'task_failed',
    'git_commit', 'pr_created',
    'reflection', 'work_session', 'subagent_run', 'deployment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Journal entries table
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_type" "journal_entry_type" NOT NULL,
  "goal_id" uuid REFERENCES "goals"("id") ON DELETE SET NULL,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL,
  "work_session_id" uuid REFERENCES "work_sessions"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "summary" text,
  "details" jsonb,
  "search_text" tsvector,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX "journal_entries_occurred_at_idx" ON "journal_entries" ("occurred_at" DESC);
CREATE INDEX "journal_entries_goal_id_idx" ON "journal_entries" ("goal_id");
CREATE INDEX "journal_entries_entry_type_idx" ON "journal_entries" ("entry_type");
CREATE INDEX "journal_entries_search_text_idx" ON "journal_entries" USING GIN ("search_text");
CREATE INDEX "journal_entries_type_occurred_idx" ON "journal_entries" ("entry_type", "occurred_at" DESC);

-- Auto-populate search_text from title + summary on INSERT/UPDATE
CREATE OR REPLACE FUNCTION journal_entries_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_text := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.summary, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_search_update
  BEFORE INSERT OR UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entries_search_trigger();
