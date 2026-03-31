-- Add admin_role enum and role column to admin_users
DO $$ BEGIN
  CREATE TYPE "public"."admin_role" AS ENUM('admin', 'editor', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "role" "public"."admin_role" NOT NULL DEFAULT 'admin';
