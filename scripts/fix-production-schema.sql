-- Fix production schema: sync DB with Drizzle schema
-- Run this on the DigitalOcean production database
-- Safe to run multiple times (IF NOT EXISTS / DO blocks)

-- ============================================
-- PART 1: Add missing enums
-- ============================================

DO $$ BEGIN
  CREATE TYPE "public"."punch_status" AS ENUM('PENDING_SIGNATURE', 'SIGNED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."overtime_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."audit_action" AS ENUM('correction', 'review', 'create', 'login', 'export', 'overtime_create', 'overtime_review');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- PART 2: Add missing columns to punches table
-- ============================================

ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "signature_url" text;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "signature_sha256" text;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "signature_signed_at" timestamp;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "signature_data" text;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "kiosk_device_id" text;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "kiosk_user_agent" text;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "kiosk_ip" text;
ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "status" "punch_status" NOT NULL DEFAULT 'SIGNED';

-- ============================================
-- PART 3: Create missing tables
-- ============================================

CREATE TABLE IF NOT EXISTS "kiosk_devices" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp
);

CREATE TABLE IF NOT EXISTS "overtime_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" varchar NOT NULL REFERENCES "employees"("id"),
  "date" timestamp NOT NULL,
  "minutes" integer NOT NULL,
  "reason" text DEFAULT 'AUTO' NOT NULL,
  "status" "overtime_status" DEFAULT 'pending' NOT NULL,
  "reviewer_id" varchar REFERENCES "employees"("id"),
  "reviewer_comment" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "punch_reviews" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "punch_id" varchar NOT NULL REFERENCES "punches"("id"),
  "reviewed_by_id" varchar NOT NULL REFERENCES "employees"("id"),
  "reviewed_at" timestamp DEFAULT now() NOT NULL,
  "note" text
);

CREATE TABLE IF NOT EXISTS "punch_corrections" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "original_punch_id" varchar NOT NULL REFERENCES "punches"("id"),
  "corrected_by_id" varchar NOT NULL REFERENCES "employees"("id"),
  "reason" text NOT NULL,
  "new_timestamp" timestamp,
  "new_type" "punch_type",
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" "audit_action" NOT NULL,
  "actor_id" varchar NOT NULL REFERENCES "employees"("id"),
  "target_type" text NOT NULL,
  "target_id" varchar NOT NULL,
  "details" text,
  "ip_address" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" varchar NOT NULL REFERENCES "employees"("id"),
  "token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);

-- ============================================
-- PART 4: Initialize Drizzle migration journal
-- This marks migration 0000 as already applied so
-- future `npx tsx scripts/migrate.ts` won't re-run it
-- ============================================

CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO "__drizzle_migrations" (hash, created_at)
SELECT '0000_known_ozymandias', 1772126576992
WHERE NOT EXISTS (
  SELECT 1 FROM "__drizzle_migrations" WHERE hash = '0000_known_ozymandias'
);

-- ============================================
-- VERIFICATION: show punches columns
-- ============================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'punches'
ORDER BY ordinal_position;
