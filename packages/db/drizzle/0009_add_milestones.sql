-- Add milestones table for multi-step planning
DO $$ BEGIN
  CREATE TYPE "milestone_status" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "title" text NOT NULL,
  "description" text,
  "status" "milestone_status" DEFAULT 'planned' NOT NULL,
  "order_index" integer DEFAULT 0 NOT NULL,
  "due_date" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "metadata" jsonb,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add optional milestone reference to goals
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "milestone_id" uuid REFERENCES "milestones"("id");
