CREATE TABLE IF NOT EXISTS "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task_category" text NOT NULL,
	"agent_role" "agent_role",
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd_micros" integer NOT NULL DEFAULT 0,
	"goal_id" uuid,
	"task_id" uuid,
	"conversation_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "llm_usage_created_at_idx" ON "llm_usage" ("created_at");
CREATE INDEX IF NOT EXISTS "llm_usage_provider_idx" ON "llm_usage" ("provider");
