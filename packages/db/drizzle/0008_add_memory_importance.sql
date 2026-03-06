ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "importance" integer NOT NULL DEFAULT 50;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "access_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "last_accessed_at" timestamp with time zone;
