CREATE TYPE "public"."automation_key" AS ENUM('bill', 'reminder_before', 'reminder_due', 'reminder_overdue', 'payment_confirmation');--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"key" "automation_key" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"custom_note" text,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_property_key" UNIQUE("property_id","key"),
	CONSTRAINT "automations_note_length" CHECK (char_length("automations"."custom_note") <= 120)
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "upi_phone" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "automations_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_property_fk" FOREIGN KEY ("property_id","org_id") REFERENCES "public"."properties"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_upi_phone_format" CHECK ("properties"."upi_phone" ~ '^[6-9][0-9]{9}$');--> statement-breakpoint

-- WhatsApp Automation (spec H6.8). Written only by the server (as the database owner,
-- after its own owner check); app users read: owners, and managers of the property.
create trigger set_updated_at before update on public.automations for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.automations for each row execute function private.audit_row();
--> statement-breakpoint
revoke all on public.automations from anon, authenticated;
--> statement-breakpoint
grant select on public.automations to authenticated;
--> statement-breakpoint
grant all on public.automations to service_role;
--> statement-breakpoint
alter table public.automations enable row level security;
--> statement-breakpoint
create policy automations_select on public.automations for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(property_id));
--> statement-breakpoint

-- Template copies for Meta approval: the bill gets the payment details and the owner's note,
-- bill and reminder get a "Pay now" link button (to /p/<token>), every automation a note.
update public.message_templates set variables = 8, buttons = '["View details"]', body = E'{{1}}: your bill for {{2}} is ready.\nTotal: {{3}}\nAmount to pay: *{{4}}*\nDue by: {{5}}\n\n{{6}}\n\nPay to: {{7}}\n\n{{8}}\n\nPay ONLY to this QR or UPI ID. RentFlow will never ask you to pay anyone else.'
  where name = 'rf_bill' and language = 'en';
--> statement-breakpoint
update public.message_templates set variables = 8, buttons = '["विवरण देखें"]', body = E'{{1}}: {{2}} का आपका बिल तैयार है।\nकुल: {{3}}\nभुगतान राशि: *{{4}}*\nअंतिम तिथि: {{5}}\n\n{{6}}\n\nभुगतान यहां करें: {{7}}\n\n{{8}}\n\nकेवल इसी QR या UPI ID पर भुगतान करें। RentFlow आपसे कभी किसी और को भुगतान करने के लिए नहीं कहेगा।'
  where name = 'rf_bill' and language = 'hi';
--> statement-breakpoint
update public.message_templates set variables = 5, buttons = '[]', body = E'{{1}}: reminder — your rent of *{{2}}* for {{3}} {{4}}. {{5}}\n\nTap *Pay now* to pay. Already paid? Ignore this message.'
  where name = 'rf_reminder' and language = 'en';
--> statement-breakpoint
update public.message_templates set variables = 5, buttons = '[]', body = E'{{1}}: याद दिलाना — {{3}} का आपका किराया *{{2}}* {{4}}। {{5}}\n\nभुगतान के लिए *अभी भुगतान* दबाएं। भुगतान कर दिया है? इस संदेश को अनदेखा करें।'
  where name = 'rf_reminder' and language = 'hi';
--> statement-breakpoint
update public.message_templates set variables = 5, body = E'{{1}}: Payment received ✅ {{2}}. Receipt {{3}} is attached. Balance: {{4}}.\n\n{{5}}'
  where name = 'rf_payment_received' and language = 'en';
--> statement-breakpoint
update public.message_templates set variables = 5, body = E'{{1}}: भुगतान मिल गया ✅ {{2}}। रसीद {{3}} संलग्न है। शेष: {{4}}।\n\n{{5}}'
  where name = 'rf_payment_received' and language = 'hi';
