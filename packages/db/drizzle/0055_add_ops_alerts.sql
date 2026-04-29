-- Ops alerts table for autonomous ops agent alert intake (idempotent)
DO $$ BEGIN
  CREATE TYPE "public"."ops_alert_source" AS ENUM('alertmanager', 'deploy', 'health', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ops_alert_status" AS ENUM('unprocessed', 'processing', 'resolved', 'ignored', 'needs-review');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ops_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "ops_alert_source" NOT NULL,
	"severity" text NOT NULL DEFAULT 'warning',
	"title" text NOT NULL,
	"body" jsonb,
	"status" "ops_alert_status" NOT NULL DEFAULT 'unprocessed',
	"resolution" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"processed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_ops_alerts_status" ON "ops_alerts" ("status", "created_at");
