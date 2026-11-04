-- RentFlow Phase 1: access rules for the billing, payment and bot tables.
--
-- App users (role `authenticated`) only READ these tables, under RLS. Every write
-- goes through the server, which checks the user's role first and then runs as
-- the database owner (see packages/server/src/context.ts). Money rows therefore
-- can't be forged from a browser even if a policy were wrong.
--
--   owner   → all rows of their org.
--   manager → rows tied to properties in user_property_access
--             (readings, bills, cash, receipts) but never bank credits,
--             inbound emails, payment matches, conversations or messages.

create function private.can_access_tenancy(p_tenancy_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_access_bed(t.bed_id) from public.tenancies t where t.id = p_tenancy_id),
    false
  );
$$;
--> statement-breakpoint
create function private.can_access_meter(p_meter_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_access_property(m.property_id) from public.meters m where m.id = p_meter_id),
    false
  );
$$;
--> statement-breakpoint
create function private.can_access_bill(p_bill_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_access_tenancy(b.tenancy_id) from public.bills b where b.id = p_bill_id),
    false
  );
$$;
--> statement-breakpoint
revoke all on function private.can_access_tenancy(uuid), private.can_access_meter(uuid), private.can_access_bill(uuid) from public;
--> statement-breakpoint
grant execute on function private.can_access_tenancy(uuid), private.can_access_meter(uuid), private.can_access_bill(uuid) to authenticated;
--> statement-breakpoint

-- ─── Ledger is append-only, even for the server ─────────────────────────────

create function private.ledger_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Allow deletes only as part of deleting the whole org (cascade).
  if tg_op = 'DELETE' and not exists (select 1 from public.orgs o where o.id = old.org_id) then
    return old;
  end if;
  raise exception 'ledger_entries is append-only: record a reversal or adjustment instead' using errcode = 'P0001';
end;
$$;
--> statement-breakpoint
create trigger append_only before update or delete on public.ledger_entries for each row execute function private.ledger_append_only();
--> statement-breakpoint

-- Approved cycles are locked (CLAUDE.md §7.4): their bills' lines can't change.
create function private.lock_approved_lines() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status public.cycle_status;
begin
  select c.status into v_status
  from public.bills b join public.billing_cycles c on c.id = b.cycle_id
  where b.id = coalesce(new.bill_id, old.bill_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'This billing cycle is approved and locked. Add an adjustment to the next bill instead.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
--> statement-breakpoint
create trigger lock_approved before insert or update or delete on public.bill_lines for each row execute function private.lock_approved_lines();
--> statement-breakpoint

-- ─── updated_at and audit triggers ──────────────────────────────────────────

create trigger set_updated_at before update on public.services for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.meters for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.meter_readings for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.billing_cycles for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.bills for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.bill_lines for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.bank_credits for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.inbound_emails for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.payment_claims for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.payment_matches for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.cash_entries for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.receipts for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.payer_aliases for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.conversations for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.message_templates for each row execute function private.set_updated_at();
--> statement-breakpoint

-- Sensitive money and settings changes (CLAUDE.md §13).
create trigger audit after insert or update or delete on public.services for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.billing_cycles for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after update or delete on public.meter_readings for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.payment_matches for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.cash_entries for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after update or delete on public.bank_credits for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.ledger_entries for each row execute function private.audit_row();
--> statement-breakpoint

-- ─── Grants: read-only for app users ────────────────────────────────────────

revoke all on
  public.services, public.meters, public.meter_readings, public.billing_cycles, public.bills, public.bill_lines,
  public.ledger_entries, public.bank_credits, public.inbound_emails, public.payment_claims, public.payment_matches,
  public.cash_entries, public.receipts, public.payer_aliases, public.conversations, public.message_log, public.message_templates
from anon, authenticated;
--> statement-breakpoint
grant select on
  public.services, public.meters, public.meter_readings, public.billing_cycles, public.bills, public.bill_lines,
  public.ledger_entries, public.bank_credits, public.inbound_emails, public.payment_claims, public.payment_matches,
  public.cash_entries, public.receipts, public.payer_aliases, public.conversations, public.message_log, public.message_templates
to authenticated;
--> statement-breakpoint
grant all on all tables in schema public to service_role;
--> statement-breakpoint

alter table public.services enable row level security;
--> statement-breakpoint
alter table public.meters enable row level security;
--> statement-breakpoint
alter table public.meter_readings enable row level security;
--> statement-breakpoint
alter table public.billing_cycles enable row level security;
--> statement-breakpoint
alter table public.bills enable row level security;
--> statement-breakpoint
alter table public.bill_lines enable row level security;
--> statement-breakpoint
alter table public.ledger_entries enable row level security;
--> statement-breakpoint
alter table public.bank_credits enable row level security;
--> statement-breakpoint
alter table public.inbound_emails enable row level security;
--> statement-breakpoint
alter table public.payment_claims enable row level security;
--> statement-breakpoint
alter table public.payment_matches enable row level security;
--> statement-breakpoint
alter table public.cash_entries enable row level security;
--> statement-breakpoint
alter table public.receipts enable row level security;
--> statement-breakpoint
alter table public.payer_aliases enable row level security;
--> statement-breakpoint
alter table public.conversations enable row level security;
--> statement-breakpoint
alter table public.message_log enable row level security;
--> statement-breakpoint
alter table public.message_templates enable row level security;
--> statement-breakpoint

create policy services_select on public.services for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(property_id));
--> statement-breakpoint
create policy meters_select on public.meters for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(property_id));
--> statement-breakpoint
create policy meter_readings_select on public.meter_readings for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_meter(meter_id));
--> statement-breakpoint
create policy billing_cycles_select on public.billing_cycles for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(property_id));
--> statement-breakpoint
create policy bills_select on public.bills for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_tenancy(tenancy_id));
--> statement-breakpoint
create policy bill_lines_select on public.bill_lines for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_bill(bill_id));
--> statement-breakpoint
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_tenancy(tenancy_id));
--> statement-breakpoint
create policy payment_claims_select on public.payment_claims for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_tenancy(tenancy_id));
--> statement-breakpoint
create policy cash_entries_select on public.cash_entries for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_tenancy(tenancy_id));
--> statement-breakpoint
create policy receipts_select on public.receipts for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_tenancy(tenancy_id));
--> statement-breakpoint
create policy payer_aliases_select on public.payer_aliases for select to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint
-- Managers can't settle UPI payments (§7.7), so they don't see the raw bank side.
create policy bank_credits_select on public.bank_credits for select to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint
create policy inbound_emails_select on public.inbound_emails for select to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint
create policy payment_matches_select on public.payment_matches for select to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint
create policy conversations_select on public.conversations for select to authenticated
  using (org_id is not null and private.is_org_owner(org_id));
--> statement-breakpoint
create policy message_log_select on public.message_log for select to authenticated
  using (org_id is not null and private.is_org_owner(org_id));
--> statement-breakpoint
create policy message_templates_select on public.message_templates for select to authenticated
  using (true);
--> statement-breakpoint

-- ─── WhatsApp templates (must match packages/core/src/templates.ts) ─────────

insert into public.message_templates (name, language, category, body, variables, buttons) values
  ('rf_welcome', 'en', 'UTILITY', 'Welcome to {{1}}, {{2}}! 🏠 You''re registered for room {{3}}, bed {{4}}. You''ll get your bills and receipts on this number. To do this, {{1}} and RentFlow store your name, phone and stay details. Tap *I agree* to continue.', 4, '["I agree","Menu"]'),
  ('rf_welcome', 'hi', 'UTILITY', '{{1}} में आपका स्वागत है, {{2}}! 🏠 आप कमरा {{3}}, बेड {{4}} के लिए पंजीकृत हैं। आपके बिल और रसीदें इसी नंबर पर आएंगी। इसके लिए {{1}} और RentFlow आपका नाम, फ़ोन और रहने का विवरण रखते हैं। आगे बढ़ने के लिए *मैं सहमत हूं* दबाएं।', 4, '["मैं सहमत हूं","मेनू"]'),
  ('rf_bill', 'en', 'UTILITY', E'{{1}}: your bill for {{2}} is ready.\nTotal: {{3}}\nAmount to pay: *{{4}}*\nDue by: {{5}}\n\n{{6}}\n\nPay ONLY to this QR. RentFlow will never ask you to pay anyone else.', 6, '["View details","Pay now"]'),
  ('rf_bill', 'hi', 'UTILITY', E'{{1}}: {{2}} का आपका बिल तैयार है।\nकुल: {{3}}\nभुगतान राशि: *{{4}}*\nअंतिम तिथि: {{5}}\n\n{{6}}\n\nकेवल इसी QR पर भुगतान करें। RentFlow आपसे कभी किसी और को भुगतान करने के लिए नहीं कहेगा।', 6, '["विवरण देखें","अभी भुगतान"]'),
  ('rf_reminder', 'en', 'UTILITY', '{{1}}: reminder — your rent of *{{2}}* for {{3}} {{4}}. Tap *Pay now* to pay. Already paid? Ignore this message.', 4, '["Pay now"]'),
  ('rf_reminder', 'hi', 'UTILITY', '{{1}}: याद दिलाना — {{3}} का आपका किराया *{{2}}* {{4}}। भुगतान के लिए *अभी भुगतान* दबाएं। भुगतान कर दिया है? इस संदेश को अनदेखा करें।', 4, '["अभी भुगतान"]'),
  ('rf_payment_received', 'en', 'UTILITY', '{{1}}: Payment received ✅ {{2}}. Receipt {{3}} is attached. Balance: {{4}}.', 4, '[]'),
  ('rf_payment_received', 'hi', 'UTILITY', '{{1}}: भुगतान मिल गया ✅ {{2}}। रसीद {{3}} संलग्न है। शेष: {{4}}।', 4, '[]'),
  ('rf_cash_confirm', 'en', 'UTILITY', '{{1}}: Manager {{2}} recorded {{3}} cash from you on {{4}}. Is this correct?', 4, '["Correct","Not correct"]'),
  ('rf_cash_confirm', 'hi', 'UTILITY', '{{1}}: मैनेजर {{2}} ने {{4}} को आपसे {{3}} नकद दर्ज किया है। क्या यह सही है?', 4, '["सही है","सही नहीं"]'),
  ('rf_refund_confirm', 'en', 'UTILITY', '{{1}}: your deposit settlement — deposit {{2}}, deductions {{3}}, refund *{{4}}*. Did you receive the refund?', 4, '["Received","Not received"]'),
  ('rf_refund_confirm', 'hi', 'UTILITY', '{{1}}: आपकी जमा राशि का हिसाब — जमा {{2}}, कटौती {{3}}, वापसी *{{4}}*। क्या आपको वापसी मिल गई?', 4, '["मिल गया","नहीं मिला"]'),
  ('rf_claim_unmatched', 'en', 'UTILITY', '{{1}}: we still haven''t received a payment matching the screenshot you sent on {{2}}. If you paid, please share the UTR / reference number with your manager.', 2, '[]'),
  ('rf_claim_unmatched', 'hi', 'UTILITY', '{{1}}: {{2}} को भेजे गए स्क्रीनशॉट से मेल खाता भुगतान अभी तक नहीं मिला है। अगर आपने भुगतान किया है, तो कृपया UTR / रेफरेंस नंबर मैनेजर को भेजें।', 2, '[]'),
  ('rf_staff_alert', 'en', 'UTILITY', 'RentFlow · {{1}}: {{2}}', 2, '[]'),
  ('rf_staff_alert', 'hi', 'UTILITY', 'RentFlow · {{1}}: {{2}}', 2, '[]');
