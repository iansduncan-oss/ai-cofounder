CREATE TABLE IF NOT EXISTS "google_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid NOT NULL UNIQUE REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "scopes" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
