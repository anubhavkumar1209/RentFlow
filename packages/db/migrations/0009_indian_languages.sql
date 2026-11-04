-- English + 12 Indian languages (founder, 2026-11-04). The type is recreated rather than
-- extended with ADD VALUE: migrations run in one transaction, and Postgres won't use a
-- value added by ADD VALUE until it's committed (0010 inserts rows that use the new values).
ALTER TYPE "public"."language" RENAME TO "language_old";--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'kn', 'ml', 'pa', 'or', 'ur', 'as');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "language" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "language" SET DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "language" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "language" SET DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "message_templates" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
DROP TYPE "public"."language_old";
