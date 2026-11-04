-- Moved first by hand: drizzle-kit emitted it after the foreign keys that depend on it.
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_id_org" UNIQUE("id","org_id");--> statement-breakpoint
CREATE TYPE "public"."bill_line_kind" AS ENUM('rent', 'fixed', 'metered', 'service', 'previous_due', 'adjustment', 'late_fee');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('draft', 'sent', 'partially_paid', 'paid');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('claimed', 'matched', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."credit_source" AS ENUM('email', 'app', 'statement', 'gateway', 'manual');--> statement-breakpoint
CREATE TYPE "public"."credit_status" AS ENUM('unmatched', 'matched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."cycle_kind" AS ENUM('monthly', 'final');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'approved', 'sent');--> statement-breakpoint
CREATE TYPE "public"."inbound_email_status" AS ENUM('parsed', 'unparsed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('charge', 'payment', 'reversal', 'deposit_in', 'deposit_out', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('unique_amount', 'utr_last4', 'manual');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."meter_scope" AS ENUM('room', 'floor', 'building');--> statement-breakpoint
CREATE TYPE "public"."reading_kind" AS ENUM('monthly', 'final');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('fixed', 'metered', 'on_request', 'plan', 'complaint_category', 'info');--> statement-breakpoint
CREATE TABLE "bank_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" "credit_source" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"utr" text,
	"payer_name" text,
	"payer_vpa" text,
	"credited_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"status" "credit_status" DEFAULT 'unmatched' NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_credits_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "bank_credits_positive" CHECK ("bank_credits"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"kind" "bill_line_kind" NOT NULL,
	"source_id" uuid,
	"description" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"period_start" date,
	"period_end" date,
	"carried" boolean DEFAULT false NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "cycle_kind" DEFAULT 'monthly' NOT NULL,
	"period" text NOT NULL,
	"tenancy_id" uuid,
	"due_date" date NOT NULL,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_cycles_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "billing_cycles_period_format" CHECK ("billing_cycles"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"total_paise" bigint NOT NULL,
	"payable_paise" bigint DEFAULT 0 NOT NULL,
	"status" "bill_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "bills_tenancy_cycle" UNIQUE("tenancy_id","cycle_id"),
	CONSTRAINT "bills_payable_non_negative" CHECK ("bills"."payable_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"received_on" date NOT NULL,
	"recorded_by" uuid NOT NULL,
	"tenant_confirmed_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_entries_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "cash_entries_positive" CHECK ("cash_entries"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"phone" text NOT NULL,
	"tenancy_id" uuid,
	"state" text DEFAULT 'idle' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"window_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_address" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"dkim_verified" boolean DEFAULT false NOT NULL,
	"status" "inbound_email_status" NOT NULL,
	"credit_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"type" "ledger_type" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_nonzero" CHECK ("ledger_entries"."amount_paise" <> 0)
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"phone" text NOT NULL,
	"tenancy_id" uuid,
	"direction" "message_direction" NOT NULL,
	"template_name" text,
	"wa_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"payload" jsonb NOT NULL,
	"cost_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"language" "language" NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"variables" smallint NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_name_language" UNIQUE("name","language")
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"kind" "reading_kind" DEFAULT 'monthly' NOT NULL,
	"period" text,
	"reading_date" date NOT NULL,
	"reading" integer NOT NULL,
	"photo_ref" text,
	"read_by" uuid,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_readings_non_negative" CHECK ("meter_readings"."reading" >= 0),
	CONSTRAINT "meter_readings_period_format" CHECK ("meter_readings"."period" is null or "meter_readings"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"scope" "meter_scope" DEFAULT 'room' NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meters_id_org" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "payer_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"payer_name" text,
	"payer_vpa" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payer_aliases_something" CHECK (num_nonnulls("payer_aliases"."payer_name", "payer_aliases"."payer_vpa") > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"screenshot_ref" text NOT NULL,
	"image_hash" text NOT NULL,
	"utr_last4" text,
	"status" "claim_status" DEFAULT 'claimed' NOT NULL,
	"flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_claims_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "payment_claims_org_hash" UNIQUE("org_id","image_hash"),
	CONSTRAINT "payment_claims_utr_last4" CHECK ("payment_claims"."utr_last4" is null or "payment_claims"."utr_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "payment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"credit_id" uuid,
	"bill_id" uuid NOT NULL,
	"claim_id" uuid,
	"method" "match_method" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"confirmed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_matches_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "payment_matches_positive" CHECK ("payment_matches"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"payment_match_id" uuid,
	"cash_entry_id" uuid,
	"number" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"pdf_ref" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_org_number" UNIQUE("org_id","number"),
	CONSTRAINT "receipts_one_source" CHECK (num_nonnulls("receipts"."payment_match_id", "receipts"."cash_entry_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "service_type" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"menu_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_id_org" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "inbound_email_token" text DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "receipt_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancies" ADD COLUMN "settlement" jsonb;--> statement-breakpoint
ALTER TABLE "bank_credits" ADD CONSTRAINT "bank_credits_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_fk" FOREIGN KEY ("bill_id","org_id") REFERENCES "public"."bills"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_cycle_fk" FOREIGN KEY ("cycle_id","org_id") REFERENCES "public"."billing_cycles"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenancy_fk" FOREIGN KEY ("tenancy_id","org_id") REFERENCES "public"."tenancies"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_tenancy_fk" FOREIGN KEY ("tenancy_id","org_id") REFERENCES "public"."tenancies"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenancy_id_tenancies_id_fk" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenancy_fk" FOREIGN KEY ("tenancy_id","org_id") REFERENCES "public"."tenancies"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_tenancy_id_tenancies_id_fk" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_read_by_users_id_fk" FOREIGN KEY ("read_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_fk" FOREIGN KEY ("meter_id","org_id") REFERENCES "public"."meters"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_aliases" ADD CONSTRAINT "payer_aliases_tenancy_fk" FOREIGN KEY ("tenancy_id","org_id") REFERENCES "public"."tenancies"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_tenancy_fk" FOREIGN KEY ("tenancy_id","org_id") REFERENCES "public"."tenancies"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_credit_fk" FOREIGN KEY ("credit_id","org_id") REFERENCES "public"."bank_credits"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_bill_fk" FOREIGN KEY ("bill_id","org_id") REFERENCES "public"."bills"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_claim_fk" FOREIGN KEY ("claim_id","org_id") REFERENCES "public"."payment_claims"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenancy_fk" FOREIGN KEY ("tenancy_id","org_id") REFERENCES "public"."tenancies"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_match_fk" FOREIGN KEY ("payment_match_id","org_id") REFERENCES "public"."payment_matches"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cash_fk" FOREIGN KEY ("cash_entry_id","org_id") REFERENCES "public"."cash_entries"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_credits_org_utr" ON "bank_credits" USING btree ("org_id","utr") WHERE "bank_credits"."utr" is not null;--> statement-breakpoint
CREATE INDEX "bill_lines_bill_idx" ON "bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_cycles_one_monthly" ON "billing_cycles" USING btree ("property_id","period") WHERE "billing_cycles"."kind" = 'monthly';--> statement-breakpoint
CREATE UNIQUE INDEX "bills_unique_payable" ON "bills" USING btree ("cycle_id","payable_paise") WHERE "bills"."payable_paise" > 0;--> statement-breakpoint
CREATE INDEX "inbound_emails_org_status_idx" ON "inbound_emails" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "ledger_entries_tenancy_idx" ON "ledger_entries" USING btree ("tenancy_id","created_at");--> statement-breakpoint
CREATE INDEX "message_log_phone_idx" ON "message_log" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "message_log_org_idx" ON "message_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meter_readings_one_monthly" ON "meter_readings" USING btree ("meter_id","period") WHERE "meter_readings"."kind" = 'monthly';--> statement-breakpoint
CREATE INDEX "meter_readings_meter_date_idx" ON "meter_readings" USING btree ("meter_id","reading_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_matches_one_per_credit" ON "payment_matches" USING btree ("credit_id") WHERE "payment_matches"."credit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_one_per_match" ON "receipts" USING btree ("payment_match_id") WHERE "receipts"."payment_match_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_one_per_cash" ON "receipts" USING btree ("cash_entry_id") WHERE "receipts"."cash_entry_id" is not null;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_inbound_email_token_unique" UNIQUE("inbound_email_token");
