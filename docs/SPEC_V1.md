# RentFlow — Build Specification for the AI Coding Agent

> **How to use this file:** Put it in the root of an empty repository as `CLAUDE.md` (or `PROJECT_SPEC.md`) and tell the agent:
> *"Read CLAUDE.md fully. Build Milestone 1 only. Stop after it, show me what you built, and wait for my approval before the next milestone."*

---

## 0. Instructions to the agent (read first)

You are the senior full-stack engineer for **RentFlow**, a solo founder's SaaS product. The founder is not a large team, so:

1. **Build one milestone at a time** (Section 12). After each milestone: run the tests, summarise what was built, list anything you assumed, and **stop and wait** for approval.
2. **Do not build later-phase features early.** If something belongs to Phase 2 or later, leave a `// TODO(phase-2)` note and move on.
3. **Prefer simple, boring, well-known tools.** No microservices, no Kubernetes, no Redis in Phase 1.
4. **Money is sacred.** Follow every rule in Section 7 exactly. When unsure about money logic, ask instead of guessing.
5. **Never hard-code one PG's behaviour.** Everything property-specific comes from the database (services, charges, messages, due dates).
6. **Write tests** for every calculation (billing, electricity split, proration, matching). A billing bug destroys trust.
7. **Ask the founder** before: adding a paid third-party service, changing the data model in Section 6, or changing any rule in Section 7.
8. Keep a `docs/DECISIONS.md` file. Record every non-obvious decision with one line of reasoning.

---

## 1. Product summary

**RentFlow** is a WhatsApp-first automation platform for PG (paying guest) owners, hostel owners and property managers in India.

- **Owner and manager** use a web app (owner on laptop, manager on phone).
- **Tenants never log in and never install anything.** They use only WhatsApp. Their WhatsApp number is their identity.
- One platform serves **many PGs independently**. Each PG has its own tenants, rooms, services, charges, rules, messages and WhatsApp menu.

**Core promise:** the owner sets up once, the manager does a few minutes of input each month, the bot handles all tenant communication, and the owner sees every rupee in the dashboard.

---

## 2. Users and roles

| Role | Where | Can do |
|---|---|---|
| **Super Admin** | Internal admin panel | Manage orgs, plans, platform health. (Phase 3+, not in MVP) |
| **Owner** | Web dashboard | Everything for their org: properties, rooms, tenants, services, prices, approve bills, settle payments, reports, staff permissions |
| **Manager** | Mobile web app (PWA) | Daily operations: add/check-out tenants, meter readings, record cash, handle tickets and service requests. **Cannot** settle UPI payments, approve billing, edit locked bills, or change prices (unless owner grants it) |
| **Tenant** | WhatsApp only | View bill, pay, get receipts, use enabled services, report problems, give notice |

Login for owner/manager: **phone number + OTP** (Supabase Auth).

---

## 3. Complete workflow

### Stage 1 — One-time setup (owner)
1. Sign up with phone OTP.
2. Create property: name, address, rent due day, UPI VPA, payee name, electricity rate.
3. Add floors → rooms → beds. Support bulk generation ("Floors 1–3, rooms 101–110, 2-sharing").
4. Add tenants: name, WhatsApp number, bed, monthly rent, deposit, check-in date, optional guardian numbers. Support CSV/Excel import.
5. Set fixed charges (Wi-Fi, maintenance) and metered charges (electricity).
6. Optionally enable extra services and complaint categories (Phase 2).
7. Add manager(s) and permissions.
8. Connect payment confirmation (forward bank credit alert emails to RentFlow).
9. Bot sends each tenant a welcome message on WhatsApp.

### Stage 2 — Every month (mostly automatic)
1. N days before the due day, system creates a **draft billing cycle**.
2. Manager enters meter readings (photo required) and variable charges.
3. System calculates each tenant's bill.
4. System flags anomalies (reading lower than last month, unusually high usage, vacant room consuming power).
5. Owner reviews and **approves** → cycle locks.
6. Bot sends each tenant their bill on WhatsApp with breakdown + payment QR/link.

### Stage 3 — Payment
1. Tenant pays via any UPI app directly to the owner's bank account.
2. Bank credit alert email is forwarded to RentFlow → parsed → matched by **unique amount**.
3. Ledger updated → bot sends **PDF receipt** on WhatsApp.
4. Reminders before/after due date until paid.
5. Amount mismatch → bot asks tenant for last 4 digits of UTR → match, or owner matches in one tap.
6. Cash → manager records → tenant confirms on WhatsApp → settled.

### Stage 4 — Daily life (Phase 2)
- Services: tenant picks service → form → reference number → status updates → charge to next bill.
- Complaints: tenant reports problem (text/photo/video/voice) → ticket → staff alerted → updates → "Is it fixed?" → escalation if ignored.

### Stage 5 — Owner oversight
Dashboard: collected vs expected, pending list, unmatched payments, manager cash in hand, room grid.

### Stage 6 — Tenant leaves
Notice → final bill (prorated rent, final meter reading, damages) → deposit settlement → tenant confirms refund on WhatsApp → bed vacant → data archived.

---

## 4. Tech stack (fixed — do not change without asking)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere (strict mode) |
| Repo | pnpm monorepo: `apps/web`, `apps/api`, `packages/db`, `packages/core` |
| Web app | Next.js (App Router) + Tailwind CSS, installable PWA |
| API + bot webhook + workers | Node.js + Fastify (`apps/api`) |
| Database | PostgreSQL on **Supabase**, with Row-Level Security |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Auth | Supabase Auth, phone OTP |
| File storage | Supabase Storage (private buckets, signed URLs only) |
| Background jobs | **pg-boss** (job queue inside Postgres). No Redis. |
| WhatsApp | **Meta WhatsApp Cloud API**, official only. Never unofficial WhatsApp Web automation. |
| PDF receipts | HTML template → PDF via headless Chromium (Puppeteer) |
| Email parsing (bank alerts) | Inbound email webhook (e.g. a transactional email provider's inbound parse) → `apps/api` |
| Tests | Vitest for unit tests; Playwright for a few critical web flows |
| Hosting | One managed Node platform for `apps/api`, Vercel (or same platform) for `apps/web`; Supabase region: **Mumbai** |

`packages/core` holds **pure business logic** (billing, proration, electricity split, matching, menu building) with **no database or network calls**, so it can be unit-tested easily.

---

## 5. Multi-tenancy

- Hierarchy: **Organisation (owner's business) → Properties → Floors → Rooms → Beds → Tenancies**.
- Every table has `org_id`. RLS policies ensure a user only sees rows of orgs they belong to.
- Manager access is further limited per property via `user_property_access`.
- **WhatsApp number mode:**
  - **Shared number (Phase 1 default):** one RentFlow number for all PGs. Incoming message → look up sender phone in active tenancies → load that PG. If more than one active tenancy → ask "Which one?" with buttons. Unknown number → "This number isn't registered. Please ask your PG manager."
  - **Own number per PG (Phase 4):** owner connects via Meta Embedded Signup. Design the code so the WhatsApp sender is chosen per property (`properties.wa_phone_number_id` nullable, falling back to the shared number).

---

## 6. Data model

All money columns are **integers in paise** (`bigint`). All timestamps are `timestamptz`. All tables have `id uuid`, `org_id`, `created_at`, `updated_at` unless noted.

| Area | Table | Key fields |
|---|---|---|
| Org | `orgs` | name, plan, whatsapp_mode |
| | `users` | phone, name, email |
| | `org_members` | org_id, user_id, role (`owner` / `manager`) |
| | `user_property_access` | user_id, property_id, permissions (jsonb) |
| Property | `properties` | name, address, due_day, reminder_rules (jsonb), late_fee_rule (jsonb), upi_vpa, payee_name, electricity_rate_paise, wa_phone_number_id (nullable) |
| | `rooms` | property_id, floor, number, sharing, meter_id |
| | `beds` | room_id, label, default_rent_paise, status (`vacant` / `occupied` / `notice` / `blocked`) |
| People | `tenants` | name, phone (E.164), guardian_phones (text[]), id_doc_ref, id_last4, consent_at |
| | `tenancies` | tenant_id, bed_id, rent_paise, deposit_paise, check_in, notice_date, check_out, status (`active` / `notice` / `closed`) |
| Services | `services` | property_id, name, type, active, config (jsonb), menu_order |
| | `service_plans` | service_id, name, price_paise, details (Phase 2) |
| | `service_subscriptions` | tenancy_id, plan_id, start_date, end_date (Phase 2) |
| | `service_requests` | service_id, tenancy_id, form_data, status, charge_paise, ref_no (Phase 2) |
| Metering | `meters` | property_id, scope (`room` / `floor` / `building`), name |
| | `meter_readings` | meter_id, period (`YYYY-MM`), reading, photo_ref, read_by, read_at |
| Billing | `billing_cycles` | property_id, period, status (`draft` / `approved` / `sent`), approved_by, approved_at |
| | `bills` | tenancy_id, cycle_id, total_paise, payable_paise (unique amount), status (`draft` / `sent` / `partially_paid` / `paid`), sent_at |
| | `bill_lines` | bill_id, kind (`rent` / `fixed` / `metered` / `service` / `previous_due` / `adjustment` / `late_fee`), source_id, description, amount_paise |
| Money | `ledger_entries` | tenancy_id, type (`charge` / `payment` / `reversal` / `deposit_in` / `deposit_out` / `adjustment`), amount_paise, ref_type, ref_id, created_by — **append-only** |
| | `bank_credits` | source (`email` / `app` / `statement` / `gateway`), amount_paise, utr, payer_name, payer_vpa, credited_at, raw (jsonb), status (`unmatched` / `matched` / `ignored`) |
| | `payment_claims` | tenancy_id, screenshot_ref, image_hash, utr_last4, status (`claimed` / `matched` / `rejected`) |
| | `payment_matches` | credit_id, bill_id, claim_id, method (`unique_amount` / `utr_last4` / `manual`), confirmed_by |
| | `cash_entries` | tenancy_id, amount_paise, recorded_by, tenant_confirmed_at, handed_over_at |
| | `receipts` | payment_match_id or cash_entry_id, number, pdf_ref |
| | `payer_aliases` | tenancy_id, payer_name, payer_vpa (remembered after owner confirms) |
| Ops | `tickets` | property_id, tenancy_id, category, priority, status, assignee_id, ref_no, due_at, visibility (`staff` / `owner_only`) (Phase 2) |
| | `ticket_events` | ticket_id, actor, action, note, media_ref (Phase 2) |
| | `expenses` | property_id, category, amount_paise, date, note, receipt_ref (Phase 3) |
| Bot | `conversations` | phone, tenancy_id, state, context (jsonb), window_expires_at |
| | `message_log` | direction, template_name, wa_message_id, status, payload (jsonb), cost_paise |
| | `message_templates` | name, language, category, body, variables, meta_status |
| Audit | `audit_log` | actor_id, action, entity, entity_id, before (jsonb), after (jsonb) |

**Database-level guarantees:**
- Unique index on `bank_credits(org_id, utr)` where utr is not null.
- Unique index on `payment_claims(org_id, image_hash)`.
- Unique index on `(cycle_id, payable_paise)` among bills of the same property → no two open bills share an amount.
- `ledger_entries` has no UPDATE/DELETE grants for app roles.

---

## 7. Money rules (must follow exactly)

1. **Store money as integer paise.** Never floats. Format with Indian grouping only in the UI (₹1,25,000.37).
2. **Balance is computed**, never stored: `sum(ledger_entries.amount_paise)` per tenancy (charges positive, payments negative).
3. **Ledger is append-only.** Mistakes are fixed with `reversal` or `adjustment` entries.
4. **Approved cycles are locked.** Any change after approval becomes an adjustment line on the next bill.
5. **Unique payable amount:** `payable_paise = round_down_to_rupee(total) + suffix`, where `suffix` is 1–99 paise, unique among open bills of that property for that cycle. If more than 99 open bills, also vary the last rupee digit downward (never charge the tenant more than ₹1 extra). Document the algorithm in `DECISIONS.md`.
6. **Receipts only after confirmation.** A receipt is generated only from a `payment_match` (bank credit matched) or a tenant-confirmed `cash_entry`, or an owner manual settle. **A screenshot alone never creates a receipt or a ledger payment.**
7. **Manager cannot settle UPI payments.** Only automatic matching or the owner.
8. **Partial payments** are allowed and allocated oldest-due-first by default.
9. **Proration:** rent for a partial month = `rent × days_occupied / days_in_month`, rounded to the nearest rupee.
10. **Electricity split by tenant-days:**
    `tenant_share = room_cost × tenant_days / sum_of_all_tenant_days_on_that_meter`
    where `room_cost = (current_reading − previous_reading) × rate`. Rounding remainder goes to the tenant with the most days (so shares always add up exactly to room cost).

**Worked test case (must pass):** Room 303, November (30 days). Anubhav (303-A) rent ₹2,000, 30 days. Anmol (303-B) rent ₹4,000, joined 11 Nov (20 days). Meter: 120 units × ₹8 = ₹960. Wi-Fi ₹200 each. Anubhav has ₹90 laundry.
- Anubhav: 2,000 + 576 + 200 + 90 = **₹2,866**
- Anmol: 2,667 + 384 + 200 = **₹3,251**

---

## 8. Payment verification

**Phase 1 — direct UPI only:**
- Each bill message includes a **dynamic UPI QR image** and a **UPI deep link**:
  `upi://pay?pa=<vpa>&pn=<payee>&am=<payable_rupees.paise>&tn=RF-<room><bed>-<MON>&cu=INR`
- Some UPI apps restrict person-to-person links with pre-filled amounts. Always include the QR image as the fallback, and clearly show the exact amount to pay.

**Bank credit capture (Phase 1: email only):**
- Each org gets a private inbound address (e.g. `<org-slug>-<random>@in.rentflow.app`).
- Owner sets an email filter to forward bank credit alerts there.
- Write parsers per bank as small pure functions in `packages/core/bank-parsers/` with fixture tests. Start with the 5–6 most common banks; unknown formats go to an "unparsed" queue the owner can view.
- Extract: amount, UTR/reference, payer name/VPA (when present), credited time.

**Matching engine (`packages/core/matching`), in this order:**

| Signal | Action |
|---|---|
| Credit amount == an open bill's `payable_paise` | Auto-settle |
| Tenant typed last 4 UTR digits + a credit with that UTR suffix within ±3 days | Auto-settle |
| Payer name/VPA in `payer_aliases` of a tenant with an open bill | Suggest; owner confirms in one tap |
| Amount close to a bill (± ₹100) | Suggest; owner confirms |
| Duplicate UTR or duplicate screenshot hash | Reject |
| Screenshot with no credit after 48 hours | Flag "no money received"; notify owner and tenant |

**No OCR.** Screenshots are stored, hashed (perceptual hash to catch reuse), and shown to the owner beside unmatched credits.

Payment gateway mode (Razorpay/Cashfree) is **Phase 3**.

---

## 9. WhatsApp bot

**Rules:**
- Official WhatsApp Cloud API only. Verify webhook signatures.
- Business-initiated messages (bills, reminders, welcome) use **pre-approved templates** stored in `message_templates`. Owners pick templates and fill variables; they cannot send arbitrary text as broadcasts.
- Replies inside the 24-hour customer service window can be free-form.
- Respect Meta's interactive limits: list messages hold at most 10 rows; reply buttons at most 3. The menu builder must group into sections/sub-menus when needed.
- Log every outbound message in `message_log`.
- Language: Hindi and English templates; tenant's language preference stored on the tenant.

**Conversation engine:** a state machine per phone number (`conversations` table). States are generated from the property's configuration. Free text the engine can't map → "I didn't understand" + main menu + [Talk to manager]. (LLM intent understanding is Phase 3.)

**Phase 1 menu (always present):**
- View my bill
- Pay now
- Send payment screenshot
- My receipts
- Talk to manager

**Phase 1 flows:**
1. **Welcome:** template on tenant creation → confirms name, PG, room/bed → main menu.
2. **Monthly bill:** template with total, due date, short breakdown, buttons [View details] [Pay now] → Pay now sends QR image + UPI link + "Pay ONLY to this QR. Never pay anyone else."
3. **Screenshot:** tenant sends image → saved as `payment_claim` → "Got it, we'll confirm once the bank shows it." If amount mismatch later, ask for last 4 UTR digits.
4. **Receipt:** on settle → "Payment received ✅ ₹X" + PDF receipt.
5. **Reminders:** per `properties.reminder_rules` (default: due−2, due, due+3, due+7). Stop when paid.
6. **Cash confirmation:** "Manager <name> recorded ₹X cash from you on <date>. [Correct] [Not correct]".

---

## 10. Service-type engine (Phase 2 — design the schema now, build later)

Every service (built-in or custom) has one of six types. The bot behaviour is derived from the type; owners never build flows.

| Type | Examples | Bot behaviour | Billing |
|---|---|---|---|
| `fixed` | Wi-Fi, maintenance, parking | No menu item; shows in bill | Every bill (Phase 1) |
| `metered` | Electricity, water | "My usage" shows readings + meter photo | Per cycle (Phase 1) |
| `on_request` | Laundry, cleaning, extra meal | Menu item → WhatsApp Flow form → ref no → status updates | Next bill or pay now |
| `plan` | Food plan, gym | View/subscribe/change/cancel | Plan price per bill |
| `complaint_category` | Water, electrical, Wi-Fi, AC | Report → ticket → updates → "Is it fixed?" | Free, or approved damage charge |
| `info` | Mess menu, rules, contacts | Shows text/image/PDF | None |

Example `services.config` for laundry:
```json
{
  "pricing": { "items": [ {"name": "Shirt", "price_paise": 1500}, {"name": "Jeans", "price_paise": 2500} ] },
  "form": [ {"field": "items", "kind": "quantity_list"}, {"field": "pickup", "kind": "slot", "slots": ["8-10 AM", "6-8 PM"]} ],
  "availability": { "days": ["Mon", "Wed", "Fri"], "cutoff": "10:00", "daily_limit": 30 },
  "access": { "who": "all_tenants", "billing": "next_bill" },
  "handler": { "assignee_user_id": "..." },
  "updates": ["Picked up", "Washing", "Delivered"]
}
```

**Menu builder** (`packages/core/menu`): pure function `buildMenu(propertyConfig, tenancy, now) → WhatsAppMenu`. Always includes core items; adds active services the tenant can access; groups into sections when > 10 rows. Cache per property; rebuild on config save.

In Phase 1, implement only `fixed` and `metered` types, but use the same `services` table and type field so Phase 2 slots in without migration pain.

---

## 11. Complaints (Phase 2)

- Tenant reports via menu or free text; can attach **text, photo, video, voice note**.
- Categories = the property's enabled `complaint_category` services + "Other".
- Ticket gets `ref_no` (e.g. `CMP-2031`), priority, `due_at` from category rules.
- Staff alerted on WhatsApp + app. Status updates notify tenant automatically.
- On resolved → "Is it fixed?" [Yes] [No]; No reopens. Optional 1–5 rating.
- **Escalation:** not acted on by `due_at` → owner alerted.
- **Incident merge:** 3+ tickets of the same category in one property within 1 hour → one incident; manager can broadcast an update to affected tenants.
- **Complaint about staff:** category "Complaint about staff" has `visibility = owner_only`. Managers can never see or query these tickets (enforce in RLS, not just UI).
- **Emergency:** category "Emergency" (fire, gas, medical, safety, harassment) → alert owner and manager immediately and repeatedly until acknowledged; bot shows emergency number 112 to the tenant at once.

---

## 12. Build order — milestones

> **Build in this exact order. Stop after each milestone for approval.**

### Phase 1 — Collect rent (MVP)

**M1. Foundation**
- Monorepo, TypeScript strict, lint, Vitest, CI running tests.
- Supabase project (Mumbai), Drizzle schema for: orgs, users, org_members, user_property_access, properties, rooms, beds, tenants, tenancies, audit_log.
- RLS policies for every table + tests proving org A cannot read org B.
- Phone OTP login; owner signup creates an org.
- ✅ Done when: an owner can sign up, log in, and RLS tests pass.

**M2. Property, rooms, tenants (web app)**
- Create/edit property (due day, UPI VPA, payee name, electricity rate).
- Bulk room/bed generator + room grid view (vacant/occupied).
- Add/edit tenant, assign bed, check-in date, rent, deposit; CSV import with validation (duplicate phone, bed capacity).
- Add manager with permissions.
- ✅ Done when: owner can set up a 30-bed PG in under 15 minutes.

**M3. Billing engine (pure logic + UI)**
- `packages/core/billing`: proration, electricity tenant-day split, fixed charges, previous dues, unique payable amount. Full unit tests including the Section 7 worked example.
- Tables: services (fixed + metered only), meters, meter_readings, billing_cycles, bills, bill_lines, ledger_entries.
- Manager: enter meter readings with photo upload.
- Owner: view draft cycle, see anomaly flags, edit lines, approve (locks cycle, writes ledger charges).
- ✅ Done when: a full month can be drafted, reviewed, approved, and balances are correct.

**M4. WhatsApp: welcome + bill + menu**
- Cloud API integration: send templates, receive webhook, verify signature, `message_log`.
- Phone → tenancy resolution on the shared number.
- Conversation state machine with Phase 1 menu.
- Bill message with breakdown, dynamic QR image (generated server-side), UPI link.
- ✅ Done when: approving a cycle sends every tenant a correct bill they can open and act on in WhatsApp.

**M5. Payment matching**
- Inbound email endpoint, per-org inbound address, bank parsers with fixture tests, unparsed queue.
- Matching engine (Section 8) with unit tests.
- Screenshot claims: store, perceptual hash, duplicate rejection, last-4-UTR follow-up.
- Owner "Payments" screen: auto-matched, suggestions to confirm, unmatched credits with screenshots beside them.
- Cash entry by manager + tenant WhatsApp confirmation + manager cash-in-hand total.
- ✅ Done when: a test credit email auto-settles the right bill, and duplicates are rejected.

**M6. Receipts and reminders**
- PDF receipt (number, PG, tenant, bed, period, lines, paid, UTR, balance, verification QR) → sent on WhatsApp.
- Public receipt verification page (signed token, no login).
- Reminder scheduler via pg-boss; stops when paid.
- ✅ Done when: paying triggers a receipt within a minute, and unpaid tenants get reminders on schedule.

**M7. Owner dashboard**
- Home: expected vs collected this month, pending list, unmatched credits, manager cash in hand.
- Tenant ledger view; month-wise collection report; CSV/Excel export.
- Check-out flow: notice → final bill → deposit settlement → tenant confirms on WhatsApp → bed vacant.
- ✅ Done when: a pilot owner can run a full month with no spreadsheet.

### Phase 2 — Services and control
M8 on-request services + WhatsApp Flows · M9 plans (food) · M10 complaints, escalation, staff-complaint privacy, emergency · M11 manager PWA polish · M12 audit log UI, tenant roll call.

### Phase 3 — Insight and polish
Google Sheets one-way sync · expenses + P&L · smart reminders with promised-date parsing · LLM intent + voice-note transcription for Hinglish · anomaly/leakage reports · optional payment gateway.

### Phase 4 — Growth
Own WhatsApp number per PG · Android notification-reader app for bank credits · bank statement parsers · hostel features · chains and multi-city · Super Admin panel.

---

## 13. Security and privacy

- India's DPDP Act: capture tenant consent on WhatsApp at onboarding; mask ID numbers (store last 4 only in plain columns); encrypt ID documents; auto-delete ID documents a configurable period after check-out.
- All storage buckets private; signed URLs with short expiry.
- Managers can view but not download ID documents.
- Every sensitive action written to `audit_log` with before/after.
- Secrets only in environment variables; never commit them.
- RentFlow never holds tenant money in Phase 1–2; it only records and matches.

---

## 14. UX rules

- Hindi + English across app and bot.
- Mobile-first for managers; works on low-end Android and slow 4G.
- Large tap targets; daily tasks in ≤ 3 taps.
- Money always shown as ₹ with Indian grouping.
- Every WhatsApp message names the PG, so tenants on the shared number know who it's from.
- Every bill message includes: "Pay ONLY to this QR. RentFlow will never ask you to pay anyone else."

---

## 15. Definition of done (every milestone)

- [ ] All new logic in `packages/core` has unit tests; all tests pass in CI.
- [ ] RLS tests still pass.
- [ ] No floats in money code.
- [ ] `docs/DECISIONS.md` updated.
- [ ] Short summary for the founder: what was built, how to try it, what's assumed, what's next.
