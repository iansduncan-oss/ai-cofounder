-- Subagent run status enum
DO $$ BEGIN
  CREATE TYPE "subagent_run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add "subagent" to agent_role enum (if not already present)
DO $$ BEGIN
  ALTER TYPE "agent_role" ADD VALUE IF NOT EXISTS 'subagent';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Subagent runs table
CREATE TABLE IF NOT EXISTS "subagent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_request_id" text,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
  "goal_id" uuid REFERENCES "goals"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "instruction" text NOT NULL,
  "status" "subagent_run_status" DEFAULT 'queued' NOT NULL,
  "output" text,
  "error" text,
  "tool_rounds" integer DEFAULT 0 NOT NULL,
  "tools_used" jsonb,
  "tokens" integer DEFAULT 0 NOT NULL,
  "model" text,
  "provider" text,
  "duration_ms" integer,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
