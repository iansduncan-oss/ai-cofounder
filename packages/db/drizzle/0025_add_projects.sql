-- Project language enum
DO $$ BEGIN
  CREATE TYPE "project_language" AS ENUM (
    'typescript', 'python', 'javascript', 'go', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Registered projects table
CREATE TABLE IF NOT EXISTS "registered_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "repo_url" text,
  "workspace_path" text NOT NULL,
  "description" text,
  "language" "project_language" NOT NULL DEFAULT 'typescript',
  "default_branch" text NOT NULL DEFAULT 'main',
  "test_command" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "config" jsonb,
  "last_ingested_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Project dependencies table
CREATE TABLE IF NOT EXISTS "project_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_project_id" uuid NOT NULL REFERENCES "registered_projects"("id") ON DELETE CASCADE,
  "target_project_id" uuid NOT NULL REFERENCES "registered_projects"("id") ON DELETE CASCADE,
  "dependency_type" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "registered_projects_name_idx" ON "registered_projects" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "registered_projects_slug_idx" ON "registered_projects" ("slug");

-- General indexes
CREATE INDEX IF NOT EXISTS "registered_projects_is_active_idx" ON "registered_projects" ("is_active");
CREATE INDEX IF NOT EXISTS "project_dependencies_source_idx" ON "project_dependencies" ("source_project_id");
CREATE INDEX IF NOT EXISTS "project_dependencies_target_idx" ON "project_dependencies" ("target_project_id");
