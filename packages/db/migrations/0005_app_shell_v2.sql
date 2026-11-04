CREATE TYPE "public"."property_status" AS ENUM('setting_up', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'billing_staff';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'maintenance_staff';--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floors_id_org" UNIQUE("id","org_id"),
	CONSTRAINT "floors_property_sort" UNIQUE("property_id","sort")
);
--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "status" "property_status" DEFAULT 'setting_up' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "floor_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "tenancies" ADD COLUMN "billing_start" date;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" "tenant_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" "language" DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-added: create floors for existing rooms, link them, then make floor_id required.
INSERT INTO "floors" ("org_id", "property_id", "name", "sort")
SELECT DISTINCT r."org_id", r."property_id", CASE WHEN r."floor" = 0 THEN 'Ground floor' ELSE 'Floor ' || r."floor" END, r."floor" FROM "rooms" r;--> statement-breakpoint
UPDATE "rooms" r SET "floor_id" = f."id" FROM "floors" f WHERE f."property_id" = r."property_id" AND f."sort" = r."floor";--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "floor_id" SET NOT NULL;--> statement-breakpoint
-- Properties created before onboarding existed are already in use.
UPDATE "properties" SET "status" = 'active';--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_fk" FOREIGN KEY ("floor_id","org_id") REFERENCES "public"."floors"("id","org_id") ON DELETE cascade ON UPDATE no action;