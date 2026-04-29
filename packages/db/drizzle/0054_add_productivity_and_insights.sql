-- Create enums for codebase insights
CREATE TYPE "public"."insight_category" AS ENUM('fix', 'improve', 'add', 'review', 'followup', 'security', 'other');
CREATE TYPE "public"."insight_severity" AS ENUM('low', 'medium', 'high', 'critical');

-- Create enums for productivity logs
CREATE TYPE "public"."productivity_mood" AS ENUM('great', 'good', 'okay', 'rough', 'terrible');

-- Create codebase_insights table
CREATE TABLE IF NOT EXISTS "codebase_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL UNIQUE,
	"category" "insight_category" NOT NULL,
	"severity" "insight_severity" NOT NULL DEFAULT 'medium',
	"title" text NOT NULL,
	"description" text,
	"suggested_action" text,
	"reference" text,
	"source" text NOT NULL,
	"status" text NOT NULL DEFAULT 'open',
	"hit_count" integer NOT NULL DEFAULT 1,
	"first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
	"resolved_at" timestamp with time zone,
	"metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "idx_codebase_insights_status_severity" ON "codebase_insights" ("status", "severity");

-- Create productivity_logs table
CREATE TABLE IF NOT EXISTS "productivity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE CASCADE,
	"date" text NOT NULL,
	"planned_items" jsonb DEFAULT '[]',
	"reflection_notes" text,
	"mood" "productivity_mood",
	"energy_level" integer,
	"completion_score" integer,
	"streak_days" integer NOT NULL DEFAULT 0,
	"highlights" text,
	"blockers" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_productivity_logs_user_date" ON "productivity_logs" ("user_id", "date");
