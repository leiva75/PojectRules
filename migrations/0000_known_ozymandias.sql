CREATE TYPE "public"."audit_action" AS ENUM('correction', 'review', 'create', 'login', 'export', 'overtime_create', 'overtime_review');--> statement-breakpoint
CREATE TYPE "public"."overtime_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."punch_status" AS ENUM('PENDING_SIGNATURE', 'SIGNED');--> statement-breakpoint
CREATE TYPE "public"."punch_type" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'manager', 'employee');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor_id" varchar NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar NOT NULL,
	"details" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"pin" varchar(6),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "kiosk_devices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "overtime_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text DEFAULT 'AUTO' NOT NULL,
	"status" "overtime_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" varchar,
	"reviewer_comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "punch_corrections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_punch_id" varchar NOT NULL,
	"corrected_by_id" varchar NOT NULL,
	"reason" text NOT NULL,
	"new_timestamp" timestamp,
	"new_type" "punch_type",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"punch_id" varchar NOT NULL,
	"reviewed_by_id" varchar NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "punches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"type" "punch_type" NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"latitude" numeric(9, 4),
	"longitude" numeric(9, 4),
	"accuracy" numeric(10, 2),
	"needs_review" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'mobile' NOT NULL,
	"signature_url" text,
	"signature_sha256" text,
	"signature_signed_at" timestamp,
	"signature_data" text,
	"kiosk_device_id" text,
	"kiosk_user_agent" text,
	"kiosk_ip" text,
	"status" "punch_status" DEFAULT 'SIGNED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_reviewer_id_employees_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_corrections" ADD CONSTRAINT "punch_corrections_original_punch_id_punches_id_fk" FOREIGN KEY ("original_punch_id") REFERENCES "public"."punches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_corrections" ADD CONSTRAINT "punch_corrections_corrected_by_id_employees_id_fk" FOREIGN KEY ("corrected_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_reviews" ADD CONSTRAINT "punch_reviews_punch_id_punches_id_fk" FOREIGN KEY ("punch_id") REFERENCES "public"."punches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_reviews" ADD CONSTRAINT "punch_reviews_reviewed_by_id_employees_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punches" ADD CONSTRAINT "punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;