CREATE TYPE follow_up_status AS ENUM ('pending', 'done', 'dismissed');

CREATE TABLE IF NOT EXISTS "follow_ups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" follow_up_status DEFAULT 'pending' NOT NULL,
  "due_date" timestamp with time zone,
  "source" text,
  "reminder_sent" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
