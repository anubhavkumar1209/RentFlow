CREATE TYPE "public"."bed_status" AS ENUM('vacant', 'occupied', 'notice', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'hi');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'manager');--> statement-breakpoint
CREATE TYPE "public"."tenancy_status" AS ENUM('active', 'notice', 'closed');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_mode" AS ENUM('shared', 'own');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"label" text NOT NULL,
	"default_rent_paise" bigint DEFAULT 0 NOT NULL,
	"status" "bed_status" DEFAULT 'vacant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beds_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "beds_room_label" UNIQUE("room_id","label"),
	CONSTRAINT "beds_rent_non_negative" CHECK ("beds"."default_rent_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_user" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"whatsapp_mode" "whatsapp_mode" DEFAULT 'shared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"due_day" smallint DEFAULT 5 NOT NULL,
	"reminder_rules" jsonb DEFAULT '{"offsets_days":[-2,0,3,7]}'::jsonb NOT NULL,
	"late_fee_rule" jsonb,
	"upi_vpa" text,
	"payee_name" text,
	"electricity_rate_paise" bigint,
	"wa_phone_number_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "properties_due_day_range" CHECK ("properties"."due_day" between 1 and 28),
	CONSTRAINT "properties_rate_non_negative" CHECK ("properties"."electricity_rate_paise" >= 0),
	CONSTRAINT "properties_upi_vpa_format" CHECK ("properties"."upi_vpa" ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$')
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"floor" smallint NOT NULL,
	"number" text NOT NULL,
	"sharing" smallint NOT NULL,
	"meter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "rooms_property_number" UNIQUE("property_id","number"),
	CONSTRAINT "rooms_sharing_range" CHECK ("rooms"."sharing" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "tenancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"rent_paise" bigint NOT NULL,
	"deposit_paise" bigint DEFAULT 0 NOT NULL,
	"check_in" date NOT NULL,
	"notice_date" date,
	"check_out" date,
	"status" "tenancy_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenancies_money_non_negative" CHECK ("tenancies"."rent_paise" >= 0 and "tenancies"."deposit_paise" >= 0),
	CONSTRAINT "tenancies_dates_ordered" CHECK ("tenancies"."check_out" is null or "tenancies"."check_out" >= "tenancies"."check_in")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"guardian_phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"id_doc_ref" text,
	"id_last4" text,
	"consent_at" timestamp with time zone,
	"language" "language" DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "tenants_org_phone" UNIQUE("org_id","phone"),
	CONSTRAINT "tenants_phone_e164" CHECK ("tenants"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "tenants_id_last4_len" CHECK ("tenants"."id_last4" is null or char_length("tenants"."id_last4") = 4)
);
--> statement-breakpoint
CREATE TABLE "user_property_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_property_access_user_property" UNIQUE("user_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_room_fk" FOREIGN KEY ("room_id","org_id") REFERENCES "public"."rooms"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_tenant_fk" FOREIGN KEY ("tenant_id","org_id") REFERENCES "public"."tenants"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_bed_fk" FOREIGN KEY ("bed_id","org_id") REFERENCES "public"."beds"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_property_access" ADD CONSTRAINT "user_property_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_property_access" ADD CONSTRAINT "user_property_access_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."org_members"("org_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_property_access" ADD CONSTRAINT "user_property_access_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tenancies_tenant_idx" ON "tenancies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenancies_one_open_per_bed" ON "tenancies" USING btree ("bed_id") WHERE "tenancies"."status" in ('active', 'notice');--> statement-breakpoint
CREATE INDEX "tenants_phone_idx" ON "tenants" USING btree ("phone");