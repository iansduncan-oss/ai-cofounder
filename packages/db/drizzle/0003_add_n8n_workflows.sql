CREATE TYPE "workflow_direction" AS ENUM ('inbound', 'outbound', 'both');

CREATE TABLE "n8n_workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "description" text,
  "webhook_url" text NOT NULL,
  "direction" "workflow_direction" DEFAULT 'outbound' NOT NULL,
  "event_type" text,
  "input_schema" jsonb,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
