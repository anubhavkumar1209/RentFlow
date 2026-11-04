# RENTFLOW — MASTER BUILD PROMPT

**WhatsApp-First PG Management and Automated Billing Platform for India**

> **How to use:** Put this file in the root of an empty repository as `CLAUDE.md`. Then tell the agent: *"Read CLAUDE.md completely. Build Milestone 1 only. When it is done, run all tests, give me a short summary, and wait for my approval before starting the next milestone."*
>
> The previous spec (Phase 1 already built against it) is kept in `docs/SPEC_V1.md`.

---

## PART A — INSTRUCTIONS TO THE AGENT

You are the lead full-stack engineer and product designer for RentFlow. The founder is a solo founder. Follow these rules for the whole project:

1. **Build one milestone at a time** (Part K). After each milestone: run all tests, write a short summary (what was built, how to try it, assumptions, what's next), and **stop and wait for approval**.
2. **Never build a later milestone's features early.** Leave `// TODO(M<number>)` and move on.
3. **Every screen you build must be fully working:** real data, real actions, loading/empty/error/success states. No fake numbers, no dead buttons, no placeholder pages inside a finished milestone.
4. **Money is sacred.** Follow Part E exactly. If a money rule is unclear, ask the founder; never guess.
5. **Nothing property-specific is hard-coded.** Services, charges, due dates, messages and menus all come from the database.
6. **Write unit tests** for every calculation (billing, proration, electricity split, matching, menu building) and **RLS tests** proving one owner can never see another owner's data.
7. **Ask before:** adding a paid third-party service, changing the data model in Part D, changing any rule in Part E, or changing the tech stack in Part C.
8. Keep `docs/DECISIONS.md`: one line per non-obvious decision and why.
9. Follow the **UI specification in Part H** for every screen. Do not produce a plain admin panel.
10. **Keep the product focused.** RentFlow is not a hotel booking system, real-estate CRM, listing site, accounting package or ERP. If a feature doesn't help a PG owner, manager or tenant do their monthly routine, don't build it.

---

## PART B — THE PRODUCT

### B1. One-line idea

The PG owner configures their property once. RentFlow handles the monthly routine and talks to tenants on WhatsApp automatically.

Desired feeling for the owner: *"I manage my PG from RentFlow. RentFlow manages the monthly routine for me."*

### B2. The problem (India, ground reality)

PG owners run their business with WhatsApp chats, Excel, notebooks, UPI screenshots, meter readings and phone calls. As a result:

- Owners don't know exactly who has paid.
- Monthly bills take hours; electricity splits are often wrong.
- Reminders are sent manually.
- Payment screenshots are unreliable: fake-payment apps, edited screenshots, and reused screenshots are common.
- Caretakers/managers can leak money: unrecorded tenants, unreported cash, payments to their own UPI.
- Complaints get lost in chats.
- Owners can't see monthly income, dues and expenses clearly.

### B3. Product principles

1. **Simple for owners** — show only what is needed to run the PG; common tasks in ≤ 3 taps.
2. **Automatic for tenants** — bills, payments, receipts, services and complaints all on WhatsApp. Tenants never log in or install anything. Their WhatsApp number is their identity.
3. **Configurable per PG** — each property has its own services, charges, rules and WhatsApp menu, on one shared platform.
4. **Trust by proof** — a bill is paid only when money is confirmed (Part F). Screenshots are hints, never proof.
5. **Separation of duties** — managers operate; money is settled by automatic bank matching, the owner, or a manager of that PG (every manual confirmation records who made it).

### B4. Users and roles

| Role | Surface | Summary |
|---|---|---|
| **Owner** | Web app (laptop + phone) | Full control of their organisation: properties, rooms, tenants, services, prices, billing approval, payment settlement, reports, staff |
| **Manager** | Same web app as an installable PWA on phone | Day-to-day operations for assigned properties, including confirming UPI payments for those properties (founder, 2026-11-04). Cannot approve billing, edit issued bills, change prices, change WhatsApp automations, or see complaints about staff — unless the owner grants a specific permission (never the staff-complaint one) |
| **Billing staff** (M11) | Web app | Enter readings and variable charges, prepare bills, record cash (tenant-confirmed). Cannot approve or settle |
| **Maintenance staff** (M11) | Phone PWA | Only complaints and service requests assigned to them |
| **Tenant** | WhatsApp + public no-login pages (bill view, pay, receipt) | View bills, pay, receipts, use enabled services, report problems, give notice |
| **Super Admin** (Phase 4) | Internal panel | Platform orgs, subscriptions, health |

Owner/staff login: phone number + OTP.

---

## PART C — TECH STACK (fixed)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language everywhere; types prevent money bugs |
| Repo | pnpm monorepo: `apps/web`, `apps/api`, `packages/db`, `packages/core`, `packages/ui` | Shared logic and types |
| Web (landing + dashboard + manager PWA + tenant public pages) | Next.js (App Router) | One app for all web surfaces |
| Styling | Tailwind CSS with design tokens (Part H) | Consistent, responsive |
| Components | shadcn/ui (Radix-based), customised to RentFlow tokens | Accessible, owned components |
| Icons | Lucide | One consistent professional icon set; no emojis as UI icons |
| Forms | React Hook Form + Zod | Same validation on client and server |
| Charts | Recharts (only where it helps a decision) | Light |
| Tables | TanStack Table | Sorting, filtering, pagination |
| API, WhatsApp webhooks, workers | Node.js + Fastify (`apps/api`) | Fast, simple |
| Database | PostgreSQL on Supabase (Mumbai region), Row-Level Security | Ledger integrity; data stays in India |
| ORM | Drizzle ORM + drizzle-kit migrations | Typed queries |
| Auth | Supabase Auth (phone OTP) | No auth code to maintain |
| Files | Supabase Storage, private buckets, signed URLs | Photos, receipts, ID docs |
| Jobs / schedules | pg-boss (queue inside Postgres) | No Redis needed |
| WhatsApp | Meta WhatsApp Cloud API (official only) | No ban risk |
| PDF | HTML templates → PDF with Puppeteer | Hindi + ₹ render correctly |
| Bank alerts | Inbound email webhook from a transactional email provider | Payment confirmation without a gateway |
| Payment gateway (optional, M14) | Razorpay | For owners who want instant confirmation |
| i18n | next-intl: English + 12 Indian languages (founder, 2026-11-04; see `packages/core/src/languages.ts`) | Everyone uses RentFlow in their own language |
| Tests | Vitest (unit), Playwright (critical flows) | Billing must be proven |
| Hosting | Vercel (web), Railway or Render (api) | No servers to manage |

`packages/core` contains pure business logic only (no database, no network): billing, proration, electricity split, unique amounts, matching, menu builder, bank-alert parsers.

---

## PART D — DATA MODEL

Rules: money columns are integer paise (`bigint`). Timestamps are `timestamptz`. Every table has `id uuid`, `org_id`, `created_at`, `updated_at` unless noted. RLS on every table.

### D1. Tables

| Area | Table | Key fields |
|---|---|---|
| Org | `orgs` | name, plan, whatsapp_mode (shared / own) |
| | `users` | phone, name, email, language |
| | `org_members` | user_id, role (owner / manager / billing_staff / maintenance_staff), active |
| | `member_permissions` | member_id, property_id, permissions (jsonb) |
| Property | `properties` | name, address, city, contact_phone, status (setting_up / active / paused), timezone |
| | `property_billing_settings` | due_day, send_days_before, reminder_schedule (jsonb), late_fee (jsonb, optional), approval_required (bool), upi_vpa, payee_name, upi_phone (optional, shown on bills) |
| | `property_rules` | text/markdown of house rules, gate timings, contacts |
| | `floors` | property_id, name, sort |
| | `rooms` | floor_id, number, sharing, meter_id, notes |
| | `beds` | room_id, label, default_rent_paise, status (vacant / occupied / reserved / unavailable) |
| People | `tenants` | name, phone (E.164), email, guardian_phones (text[]), language, id_doc_ref, id_last4, consent_at, status |
| | `tenancies` | tenant_id, bed_id, deposit_paise, check_in, billing_start, notice_date, check_out, status (active / notice / closed) |
| | `tenancy_rent_periods` | tenancy_id, rent_paise, effective_from, effective_to |
| | `tenancy_service_overrides` | tenancy_id, service_id, enabled, price_override_paise, discount (jsonb) |
| Services | `services` | property_id, name, description, icon, type, active, chargeable, config (jsonb), menu_order |
| | `service_plans` | service_id, name, price_paise, details |
| | `service_subscriptions` | tenancy_id, plan_id, start_date, end_date |
| | `service_requests` | service_id, tenancy_id, form_data (jsonb), status, charge_paise, ref_no, assignee_id |
| Metering | `meters` | property_id, scope (room / floor / building), name |
| | `meter_readings` | meter_id, period (YYYY-MM), reading, photo_ref, read_by, read_at, flagged (bool), flag_reason |
| Billing | `billing_cycles` | property_id, period, status (draft / approved / sent), approved_by, approved_at |
| | `bills` | tenancy_id, cycle_id, bill_no, period_start, period_end, issue_date, due_date, total_paise, payable_paise, status (draft / issued / partially_paid / paid / void), public_token |
| | `bill_lines` | bill_id, kind (rent / fixed / metered / plan / service_request / previous_due / advance_applied / discount / adjustment / late_fee / rounding), source_id, description, quantity, unit_paise, amount_paise |
| | `credit_debit_notes` | tenancy_id, bill_id, amount_paise (±), reason, created_by, approved_by |
| Money | `ledger_entries` | tenancy_id, type (charge / payment / reversal / adjustment / deposit_in / deposit_out / refund), amount_paise, ref_type, ref_id, created_by — **append-only** |
| | `bank_credits` | source (email / app / statement / gateway), amount_paise, utr, payer_name, payer_vpa, credited_at, raw (jsonb), status (unmatched / matched / ignored) |
| | `payment_claims` | tenancy_id, bill_id, screenshot_ref, image_hash, utr_last4, status (claimed / matched / rejected / expired) |
| | `payment_matches` | credit_id, bill_id, claim_id, amount_paise, method (unique_amount / utr_last4 / alias / manual / gateway), confirmed_by |
| | `cash_entries` | tenancy_id, amount_paise, recorded_by, recorded_at, tenant_confirmed_at, tenant_disputed_at, handed_over_at |
| | `payer_aliases` | tenancy_id, payer_name, payer_vpa |
| | `receipts` | receipt_no, tenancy_id, payment_match_id / cash_entry_id, amount_paise, pdf_ref, public_token |
| | `deposit_settlements` | tenancy_id, deposit_paise, deductions (jsonb), dues_paise, refund_paise, status, tenant_confirmed_at |
| Ops | `tickets` | property_id, tenancy_id, ticket_no, category, description, priority, status, assignee_id, due_at, visibility (staff / owner_only), incident_id |
| | `ticket_events` | ticket_id, actor, action, note, media_ref |
| | `incidents` | property_id, category, status, message |
| | `notices` | property_id, title, body, audience, sent_at |
| | `expenses` | property_id, category, description, amount_paise, date, attachment_ref, created_by, approved_by |
| WhatsApp | `conversations` | phone, tenancy_id, state, context (jsonb), window_expires_at |
| | `message_templates` | key, language, category, body, variables, meta_status |
| | `automations` | property_id, key (bill, reminder_before, reminder_due, reminder_overdue, payment_confirmation, complaint_ack, complaint_update, notice), enabled, template_key, custom_note, schedule (jsonb), status |
| | `message_log` | property_id, tenancy_id, direction, template_key, wa_message_id, status (queued / sent / delivered / read / failed), error, payload (jsonb), cost_paise |
| Audit | `audit_log` | actor_id, action, entity, entity_id, before (jsonb), after (jsonb) |

### D2. Database guarantees

- Unique `(org_id, utr)` on `bank_credits` where utr is not null.
- Unique `(org_id, image_hash)` on `payment_claims`.
- Unique `payable_paise` among open bills of the same property and cycle.
- `ledger_entries`, `bill_lines` of issued bills, and `audit_log`: no UPDATE/DELETE for app roles.
- Tickets with `visibility = 'owner_only'` are invisible to every non-owner role **in RLS**, not only in the UI.

---

## PART E — MONEY RULES (must follow exactly)

1. **Integer paise only.** No floats anywhere in money code. Display as ₹ with Indian grouping (₹1,25,000).
2. **Balance is computed, never stored:** sum of the tenancy's `ledger_entries` (charges positive, payments/credits negative).
3. **Ledger is append-only.** Fix mistakes with `reversal` or `adjustment` entries.
4. **Issued bills are never edited.** Corrections are made with a credit or debit note (immediate, tenant notified with reason) or an adjustment line on the next bill. Changing property settings or prices never changes past bills.
5. **Rent changes** are new `tenancy_rent_periods` with `effective_from`; they apply only to future cycles.
6. **Proration** (joins, leaves, room transfers): `rent × days_in_segment / days_in_month`, rounded to the nearest rupee, per rent period / bed segment.
7. **Electricity — split by tenant-days:**
   `tenant_share = meter_cost × tenant_days / total_tenant_days_on_that_meter`
   `meter_cost = (current_reading − previous_reading) × rate`
   The rounding remainder goes to the tenant with the most days so shares add up exactly to `meter_cost`. Supported modes per property: per room meter, per floor meter, per building meter, fixed amount per tenant, included in rent.
8. **Unique payable amount:** `payable_paise = total rounded down to the rupee + suffix (1–99 paise)`, unique among open bills of that property in that cycle. If more than 99 open bills, vary the last rupee digit downward. The suffix is added to the bill as a **visible rounding line** ("Payment ID adjustment ₹0.37"), so the bill total always equals the amount to pay and the ledger balances to zero when paid. The tenant never pays more than ₹0.99 extra. Document in DECISIONS.md.
9. **A bill becomes paid only from a trusted confirmation:** matched bank credit, gateway webhook (M14), owner manual settle, or tenant-confirmed cash. A screenshot or a tenant's "OK" is never proof.
10. **Who may confirm a UPI payment by hand:** the owner, or a manager of that tenant's PG. Billing and maintenance staff cannot. Each confirmation records who made it and is audit-logged. (Changed by the founder on 2026-11-04; previously only owners.)
11. **Partial payments** are allowed and allocated oldest-due-first (previous dues → metered → services → rent), unless the owner changes the order.
12. **Overpayment** becomes an advance credit on the ledger and is applied automatically to the next bill (`advance_applied` line).
13. **Refunds** (overpayment or deposit) are `refund` / `deposit_out` ledger entries with a reference; RentFlow only records them, it does not move money.
14. **Expected vs collected are separate.** Unpaid bills are never counted as income.
15. **Deposits** are tracked separately from income (`deposit_in`, `deposit_out`) and never shown as revenue.

**Required test case (must pass):** Room 303, November (30 days), meter 120 units × ₹8 = ₹960. Wi-Fi ₹200 each.

- Anubhav (303-A): rent ₹2,000, 30 days, laundry ₹90 → 2,000 + 576 + 200 + 90 = **₹2,866**
- Anmol (303-B): rent ₹4,000, joined 11 Nov (20 days) → 2,667 + 384 + 200 = **₹3,251**

---

## PART F — PAYMENTS AND VERIFICATION

### F1. Payment modes (per property)

| Mode | Tenant experience | Confirmation | Phase |
|---|---|---|---|
| Direct UPI (default) | Pays the owner's own UPI via QR or UPI app button | Bank credit alert matched automatically | Phase 1 |
| Gateway (optional) | Razorpay checkout (UPI, cards, netbanking) | Signed webhook, verified server-side | M14 |
| Cash | Pays the manager | Tenant confirms on WhatsApp | Phase 1 |

### F2. Public payment page (no login)

`/p/<public_token>` — mobile-first page opened from WhatsApp:

- PG name, tenant first name, bed, billing period, itemised bill, exact amount to pay, due date, status.
- **Pay with UPI app** button using `upi://pay?pa=<vpa>&pn=<payee>&am=<payable>&tn=RF-<bill_no>&cu=INR` (Android opens the app chooser).
- **QR code** of the same link (for iPhone, a second phone, or if the app blocks pre-filled amounts).
- Warning banner: "Pay only to <payee name>. RentFlow never asks you to pay anyone else."
- **"I've paid"** → upload screenshot (optional) → shows "We're confirming with the bank. You'll get your receipt on WhatsApp."
- Live status: Unpaid / Confirming / Partially paid / Paid ✓ (with receipt link).
- Never show "Payment successful" unless the bill is actually settled.

### F3. Capturing bank credits (direct UPI)

- Each org gets a private inbound email address (e.g. `<org>-<random>@in.rentflow.app`).
- Onboarding step shows the owner how to forward their bank's credit alert emails there, with a "send test" check.
- Parsers per bank in `packages/core/bank-parsers/`, each with fixture tests. Start with the most common Indian banks; unknown formats go to an **Unparsed alerts** list the owner can review.
- Extract: amount, UTR/reference, payer name/VPA when present, credited time.
- Later (Phase 4): Android notification-reader app and statement upload.

### F4. Matching engine (`packages/core/matching`), in order

| Signal | Action |
|---|---|
| Credit amount == an open bill's `payable_paise` | Auto-settle |
| Tenant-provided last 4 UTR digits match a credit within ±3 days | Auto-settle |
| Payer name/VPA in `payer_aliases` of a tenant with an open bill | Suggest; owner confirms in one tap |
| Amount within ±₹100 of an open bill | Suggest; owner confirms |
| One credit covers several bills (roommates, parent) | Owner splits; payer alias saved |
| Duplicate UTR, or duplicate screenshot hash | Reject and log |
| Screenshot with no matching credit after 48 hours | Flag "No money received"; notify owner; polite message to tenant |
| Duplicate gateway webhook | Idempotent: ignore repeats by event id |

**No OCR.** Screenshots are stored, perceptual-hashed (to catch reuse) and shown beside unmatched credits.

### F5. After confirmation (automatic)

Ledger payment entry → bill status update → receipt PDF generated → WhatsApp "Payment received" with receipt → dashboard updated → reminders for that bill stop.

### F6. Cash

Manager records cash → tenant gets WhatsApp: "Manager <name> recorded ₹X cash from you on <date>. [Correct] [Not correct]" → settles only on Correct → "Not correct" opens an owner-only ticket. The owner sees each staff member's cash in hand until marked handed over.

### F7. Receipt

Receipt number, PG name, owner/payee name, tenant, bed, period, line items, amount paid, method, UTR/reference, date, balance remaining, QR to `/r/<public_token>` verification page. Optional owner PAN field for tenants claiming HRA.

---

## PART G — WHATSAPP AUTOMATION

### G1. Rules

- Official WhatsApp Cloud API only. Verify webhook signatures.
- **Number arrangement (decided):** Phase 1 uses one shared RentFlow number for all PGs; every message names the PG. Own number per PG is a Phase 4 premium option via Meta Embedded Signup. Code must choose the sender per property (`whatsapp_mode`) so this slots in later.
- **Tenant routing:** incoming phone → active tenancy → property config. Multiple active tenancies (e.g. a guardian) → "Which one?" buttons. Unknown number → "This number isn't registered. Please contact your PG."
- Business-initiated messages use **Meta-approved templates** (`message_templates`). Owners cannot write free-form broadcast messages; they enable/disable automations, choose an approved template variant, and may fill a short custom-note variable. Free-form replies are allowed only inside the 24-hour customer service window.
- Respect interactive limits: list messages ≤ 10 rows, reply buttons ≤ 3. The menu builder groups into sections/sub-menus automatically.
- Consent: welcome message records opt-in; honour opt-out ("STOP").
- Log every message with delivery status; failed sends surface in the dashboard.
- Templates in every Meta-supported language we offer (English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Urdu); Odia and Assamese tenants get Hindi on WhatsApp but their own language on the pay page. Tenant language preference.

### G2. Tenant menu (built per property by `packages/core/menu`)

`buildMenu(propertyConfig, tenancy, now) → WhatsAppMenu` (pure function, unit-tested).

**Always present:**

- **Payments:** View current bill · Pay now · Previous bills · My receipts · Send payment screenshot
- **Help:** Report a problem · My complaints · Notices · House rules & contacts · Talk to manager · Give notice to leave

**Added automatically from the property's enabled services (M9):**

- **Services:** e.g. Laundry · Room cleaning · Food plan & today's menu · any custom on-request or plan service

Services the property hasn't enabled, or that don't apply to that tenant, never appear.

### G3. Core flows

- **Welcome** (on tenant creation): PG name, room/bed, rent, due day, consent, main menu.
- **Monthly bill** (template): "Hello Rahul, your November bill for Sunrise PG (Room 204) is ready. Total ₹11,500.37, due 10 Nov." Buttons: [View bill] [Pay now] [Contact manager]. View bill → itemised breakdown in chat + link to the public page. Pay now → public payment page link + QR image.
- **Screenshot:** saved as a payment claim → "Thanks, we're confirming with the bank." If amount mismatched later → ask for last 4 UTR digits.
- **Payment confirmation:** "Payment received ✅ ₹11,500.37 for November. Receipt attached." Optional [OK] button (acknowledgement only, never proof).
- **Reminders:** per property schedule (default: 2 days before, due day, +3, +7, then weekly). Never sent to fully paid bills. Partial payers get the remaining balance. Replies like "salary 10 ko aayegi" → saved as a promised date (M15 uses AI; before that, a [Promise a date] button).
- **Bill question:** [Question this bill] → billing ticket to owner.
- **Notices:** owner posts a notice → approved notice template to selected tenants.
- **Notice to leave:** tenant gives notice → owner/manager notified → move-out flow.
- **Free text:** before M15, unrecognised text → "Choose from the menu" + menu + [Talk to manager]. M15 adds AI intent understanding (Hinglish) and voice-note transcription.

---

## PART H — UI / UX SPECIFICATION

### H1. Design direction

A polished, trustworthy, fintech-quality product (clarity like Razorpay/Stripe dashboards, simplicity like PhonePe/GPay). Calm, professional, never cluttered. Use references for usability only; do not copy any product's interface or branding.

### H2. Design tokens (`packages/ui/tokens`)

| Token | Value |
|---|---|
| Primary | `#0F766E` teal (hover `#115E59`, soft `#E6F4F1`), accent mint `#5EEAD4` — changed from blue `#2F5BEA` by the founder on 2026-11-04 with the "Confirmed Home" logo |
| Success | `#15803D` (soft `#E7F6EC`) |
| Warning | `#B45309` (soft `#FDF3E2`) |
| Danger | `#C62828` (soft `#FCEBEB`) |
| Info | `#0E7490` (soft `#E3F4F8`) |
| Text | primary `#0F172A`, secondary `#475569`, muted `#94A3B8` |
| Surfaces | page `#F8FAFC`, card `#FFFFFF`, border `#E2E8F0` |
| Font | Inter (Latin) + Noto Sans Devanagari (Hindi); numbers use tabular figures |
| Type scale | 12 / 14 / 16 (body) / 20 / 24 / 32 / 40 (landing hero) |
| Radius | 8 (inputs, chips), 12 (cards), 16 (modals, landing cards) |
| Spacing | 4-px grid; card padding 16 (mobile) / 24 (desktop) |
| Shadow | one soft card shadow; no heavy shadows |
| Icons | Lucide, 20 px in UI, 16 px inside chips/buttons, stroke 1.75 |

Dark mode: not in Phase 1; keep all colours as tokens so it can be added.

### H2a. Logo

"Confirmed Home": a white house outline with a mint tick on a teal rounded square (`apps/web/components/brand/logo.tsx`, `apps/web/public/icon.svg`). Motion: "Draw & confirm" — the outline draws, the tick snaps in with a small pop; plays once on load and on hover of the logo. The browser-tab icon is static; no motion for reduced-motion users.

### H3. Icon map (use consistently)

Overview `LayoutDashboard` · Properties `Building2` · Rooms & beds `DoorOpen` / `BedDouble` · Tenants `Users` · Bills `Receipt` · Payments `Wallet` · Bank match `Landmark` · Cash `Banknote` · Electricity `Zap` · Water `Droplets` · Wi-Fi `Wifi` · Food `UtensilsCrossed` · Laundry `Shirt` · Cleaning `Sparkles` · Parking `Car` · AC `AirVent` · Maintenance `Wrench` · Complaints `MessageSquareWarning` · Emergency `Siren` · WhatsApp automation `MessageCircle` · Notices `Megaphone` · Expenses `ReceiptIndianRupee` · Reports `BarChart3` · Team `UserCog` · Settings `Settings` · Audit `History`.

### H4. Status chips (same colours everywhere)

| Status | Colour |
|---|---|
| Paid, Resolved, Active, Delivered, Occupied | Success |
| Partially paid, Due soon, Waiting, Notice period, Confirming | Warning |
| Overdue, Failed, Disputed, Emergency, No money received | Danger |
| Draft, Vacant, Paused, Closed | Neutral |
| Issued, Assigned, In progress, Reserved | Info/Primary |

### H5. Layout and navigation

**Desktop (≥ 1024 px):** left sidebar (240 px, collapsible) + top bar (property switcher "All properties ▾", search, notifications bell, profile). Content max width 1280 px.

Sidebar (owner):

- Overview
- My PGs
- Rooms & Beds
- Tenants
- Bills & Payments
- WhatsApp Automation
- Complaints
- Expenses & Reports
- Settings (Team, Billing settings, Payment setup, Profile, Audit log)

Items appear only when relevant to the user's role.

**Mobile (< 768 px):** top bar with property switcher; bottom tab bar:

- Owner: Overview · Tenants · Payments · Complaints · More
- Manager: Today · Readings · Tenants · Tickets · More

**Tablet:** collapsed icon sidebar.

**Global rules:** no horizontal page scroll; tables become stacked cards on mobile; tap targets ≥ 44 px; primary action always visible (sticky bottom button on mobile forms); confirmation dialog before sensitive actions (approve cycle, settle, void, delete, move-out); toast for success; inline field errors; skeleton loaders; helpful empty states with one clear action; every metric is clickable to its detail list.

### H6. Screens — owner/manager app

**1. Sign up / Log in** — phone → OTP → name and language. Nothing else.

**2. Onboarding wizard** (progress bar with 8 steps, save and resume anytime; checklist card on Overview until complete):

1. Account (done)
2. Add PG: name, address, city, contact number
3. Rooms & beds: bulk generator ("Floors 1–3, rooms 101–110, 2 beds each, rent ₹6,000") + grid preview + edit individual beds
4. Services: checklist cards with icons (Electricity, Water, Wi-Fi, Maintenance, Food, Laundry, Cleaning, Parking, AC, + Custom). Each opens a short form: free/chargeable, type, price, applies to (all / selected rooms / selected tenants)
5. Billing rules: due day, send bills N days before, reminder schedule (sensible default preselected), approve before sending (on by default), late fee (off by default)
6. Payment setup: UPI ID + payee name (QR preview), then bank-alert forwarding with a test step
7. Tenants: add one, import CSV/Excel (template download, row-by-row validation preview), or share an invite link
8. WhatsApp: preview the tenant menu and welcome message exactly as tenants will see it → "Send welcome messages"

Finish → "Your first bills will be prepared on <date>."

**3. Overview** — property switcher (All / single PG). Cards (each clickable):

- Expected this month · Collected · Outstanding · Overdue (count + amount)
- Beds: occupied / vacant / notice
- Needs attention list: payments to confirm, unparsed bank alerts, flagged meter readings, failed WhatsApp messages, overdue complaints, emergencies, staff cash in hand
- Recent payments (last 10)
- Open complaints by priority
- Automation status (active / paused / needs attention)
- One small chart: collected vs expected, last 6 months

**4. My PGs** — property cards (name, city, beds occupied/total, collection % this month, open complaints, status). Property detail tabs: Details · Services · Billing settings · Payment setup · House rules · Status (active/paused).

**5. Rooms & Beds** — visual grid by floor: each room a card, beds as coloured tiles (occupied/vacant/reserved/unavailable/notice) with tenant first name and dues dot. Filters: floor, status, sharing. Click bed → side panel: tenant, rent, dues, actions (assign tenant, reserve, mark unavailable, transfer, start move-out). Meter assignment per room.

**6. Tenants** — searchable table (name, phone, PG, room/bed, rent, balance, status, last payment). Tenant profile tabs: Overview (bed, rent history, deposit, services enabled, discounts) · Ledger (every charge/payment, running balance) · Bills · Receipts · Complaints · Messages (WhatsApp log) · Documents (ID masked; managers view-only). Actions: edit, change rent (from a future date), transfer room, record cash, add credit/debit note, give notice/move-out, resend welcome, change number.

**7. Bills & Payments** — tabs:

- **Billing cycle:** current cycle status stepper (Draft → Readings → Review → Approved → Sent). Readings entry (per meter, photo, previous reading shown, anomaly warnings). Variable charges entry. Review table: every tenant's bill with expandable lines, flags highlighted. "Approve & send" with confirmation summary (count, total).
- **Bills:** all bills with filters (property, month, status, tenant). Bill detail: lines, payments applied, notes, public link, resend.
- **Payments inbox:** three sections — Needs your confirmation (suggested matches with one-tap Confirm/Split/Not this), Unmatched credits, Screenshots without money — plus Auto-matched history. Screenshot shown beside credit.
- **Cash:** entries with tenant confirmation state; staff cash-in-hand summary; "Mark handed over".
- **Unparsed bank alerts:** raw email preview, manual entry form.

**8. WhatsApp Automation** — tabs:

- **Connection:** current arrangement (shared RentFlow number, or own number in Phase 4) explained in plain words; health status.
- **Automations:** cards for Bill, Reminders (before/due/overdue), Payment confirmation, Complaint acknowledgement, Complaint updates, Notices. Each: on/off, template variant (English/Hindi), custom note field, schedule, live phone-frame preview, status chip (Active / Paused / Failed / Needs attention).
- **Tenant menu preview:** phone mock showing the exact generated menu for a chosen tenant.
- **Notices:** compose from notice template, choose audience (all / floor / selected), preview, send.
- **Message history:** filterable log with delivery status and errors; retry failed.

**9. Complaints** — board (Open · Assigned · In progress · Waiting · Resolved · Closed) and list view. Card: ticket no, category icon, room, tenant, age, priority, assignee, overdue badge. Detail drawer: description, photos/voice/video, timeline, status change (auto-notifies tenant), assign, internal notes, charge request (needs owner approval). Emergency tickets pinned in red at top with acknowledge button. "About staff" tickets visible only to owner.

**10. Services** (inside My PGs → Services, and in M9 its own tab): service cards with icon, type badge, price, on/off toggle, "applies to", and for on-request/plan services: requests list and status updates. "+ Custom service": name, icon, type, price, form fields, availability, assignee — preview of how it appears in WhatsApp.

**11. Expenses & Reports** — Expenses: list + add (category, description, property, amount, date, attachment); staff-added expenses await owner approval. Reports: Monthly billing · Collection · Outstanding & overdue · Tenant ledger · Property-wise income · Expenses · Occupancy · Electricity usage · Complaints. Each: filters (property, month, tenant, status), on-screen table, download Excel/PDF. Financial summary: rent income, service income, other income, expenses, net operating income, outstanding, deposits held, refunds — expected and collected shown separately.

**12. Settings** — Team (invite by phone, role, properties, permission toggles), Billing defaults, Payment setup, Profile & language, Google Sheets (M12), Audit log (owner only: who changed what, when, before/after).

**13. Manager "Today" screen (mobile)** — task cards: readings due, tickets assigned (overdue first), service requests, tenants to check in/out, cash to hand over. Big buttons: Take reading (camera opens), Record cash, New tenant.

### H7. Tenant public pages (no login, mobile-first, PG-branded header)

- `/p/<token>` Bill & pay (F2)
- `/r/<token>` Receipt view + PDF download + "Verified by RentFlow" check
- `/invite/<code>` Tenant self-registration form (name, phone verified by WhatsApp, emergency contact, ID upload with consent) → goes to owner for approval

### H8. Landing website (M13; a simple one-page version is allowed earlier for pilots)

Sections: Hero ("Manage your PG. Automate monthly billing. Collect payments. Handle tenant requests — through one simple system." + primary CTA "Start free" + secondary "Book a demo" + product screenshot and WhatsApp phone mock) · Problems owners face · How it works (3 steps) · WhatsApp automation (animated phone mock of bill → pay → receipt) · Monthly billing & electricity · Payments you can trust (bank-confirmed, no fake screenshots) · Complaints · Owner dashboard preview · Tenant experience · Built for small and growing PGs · Pricing (per occupied bed) · FAQ · Contact/demo form · Footer (product, privacy policy, terms, contact). Use real product screenshots from the built app, not invented interfaces. English + Hindi toggle. Fast (Lighthouse ≥ 90 on mobile).

### H9. Accessibility and quality

WCAG AA contrast, keyboard navigation, focus states, labels on all inputs, aria on icon-only buttons, readable at 320 px width, works on slow 4G (lazy-load images, small bundles).

---

## PART I — SERVICES ENGINE

Every service — built-in or custom — has one type. The type decides billing and WhatsApp behaviour; owners never build bot flows.

| Type | Examples | Owner configures | WhatsApp behaviour | Billing | Built in |
|---|---|---|---|---|---|
| `fixed` | Wi-Fi, maintenance, parking, security | Amount, applies to | Shown in bill breakdown | Every bill | M3 |
| `metered` | Electricity, water | Meter mode, rate, split rule | "My usage" with readings + meter photo | Each cycle | M3 |
| `included` | Water included in rent | Description only | Shown as "Included" | None | M3 |
| `on_request` | Laundry, room cleaning, extra meal | Price list, form fields, slots, daily limit, assignee, status steps | Menu item → form (WhatsApp Flow) → ref no → status updates | Next bill or pay now | M9 |
| `plan` | Food/mess plan, gym, AC | Plans + prices, change rules | View plans · subscribe · change · cancel · today's menu | Plan price each cycle | M9 |
| `one_time` | Key replacement, mattress, registration | Amount | None (added by staff) | Next bill | M3 |
| `complaint_category` | Water, electrical, Wi-Fi, AC, plumbing, cleaning | Assignee, priority, response time, escalation | Appears in "Report a problem" | Free, or approved damage charge | M8 |
| `info` | Mess menu, house rules, gate timings | Text/image/PDF | Shown on request; optional notice on change | None | M8 |

Example config (laundry):

```json
{
  "pricing": { "items": [ {"name": "Shirt", "price_paise": 1500}, {"name": "Jeans", "price_paise": 2500} ] },
  "form": [ {"field": "items", "kind": "quantity_list"}, {"field": "pickup", "kind": "slot", "slots": ["8-10 AM", "6-8 PM"]} ],
  "availability": { "days": ["Mon", "Wed", "Fri"], "cutoff": "10:00", "daily_limit": 30 },
  "access": { "who": "all_tenants", "billing": "next_bill" },
  "handler": { "assignee_member_id": "..." },
  "status_steps": ["Picked up", "Washing", "Delivered"]
}
```

Per-tenant overrides (`tenancy_service_overrides`) allow enabling/disabling a service or a special price for one tenant.

---

## PART J — COMPLAINTS

- Tenant reports via menu or free text, with text, photo, video or voice note.
- Categories = the property's enabled complaint categories + Other + **Complaint about staff** + **Emergency**.
- Ticket number (e.g. `CMP-2031`), priority and due time from category settings; tenant gets confirmation with expected response time.
- Assigned person notified on WhatsApp and in the app.
- Statuses: Open → Assigned → In progress → Waiting → Resolved → Closed. Every change notifies the tenant automatically.
- On Resolved: "Is it fixed?" [Yes] [No]. No → reopens. Yes → optional 1–5 rating → Closed.
- Tenant can check status anytime from "My complaints".
- **Escalation:** not acted on by due time → owner alerted.
- **Duplicates:** same tenant, same category within 24 h → linked, not duplicated.
- **Incidents:** 3+ tenants, same category, same property within 1 h → grouped into one incident; manager sends one update to all.
- **Manager unavailable:** if the assignee doesn't acknowledge in time, auto-reassign to the backup person or owner.
- **Complaint about staff:** visible only to the owner (enforced by RLS).
- **Emergency** (fire, gas, medical, safety, harassment): alert owner and manager immediately and repeatedly until acknowledged; tenant immediately sees emergency number 112.

---

## PART K — BUILD ORDER (milestones)

> Stop after each milestone for approval. Each milestone must be fully working end to end.

### PHASE 1 — Core: bill, collect, confirm (MVP)

**M1. Foundation and app shell**
Monorepo, CI, lint, Vitest. Supabase (Mumbai). Drizzle schema + RLS for org, users, members, properties, floors, rooms, beds, tenants, tenancies, audit_log. RLS isolation tests. Phone OTP auth; signup creates org. Design tokens, `packages/ui` components (button, input, select, card, chip, table/card list, dialog, drawer, toast, skeleton, empty state), sidebar + top bar + mobile bottom tabs, property switcher, i18n scaffolding (EN/HI).
✅ Owner can sign up and see an empty, responsive app shell; RLS tests pass.

**M2. Onboarding, properties, rooms, tenants**
Wizard steps 1–3 and 7 (others show "coming next" only inside the wizard). My PGs, Rooms & Beds grid, Tenants list + profile (overview tab), CSV/Excel import with validation, rent periods, room transfer, team invite (owner + manager roles).
✅ Owner sets up a 30-bed PG in under 15 minutes on a phone.

**M3. Services (fixed/metered/included/one-time) and billing engine**
Services step of wizard. Billing settings step. `packages/core/billing` (proration, tenant-day split, overrides, discounts, previous dues, advance credit, unique payable amount) with full tests incl. Part E test case. Meter readings with photo + anomaly flags. Billing cycle stepper, review table, approve with confirmation. Ledger charges written on approval. Credit/debit notes.
✅ A full month is drafted, reviewed, approved; every balance is correct.

**M4. WhatsApp core and tenant public pages**
Cloud API (send templates, receive webhook, signature check), `message_log` with delivery statuses, tenant routing, conversation state machine, Phase 1 menu (Payments + Help groups), welcome, bill message, View bill, previous bills, notices (basic), talk to manager. Public bill/pay page `/p/<token>` with UPI button + QR. Wizard step 8.
✅ Approving a cycle sends every tenant a correct bill they can open and act on.

**M5. Payment confirmation**
Payment setup wizard step with inbound email + test. Bank parsers with fixtures. Matching engine (Part F4). Screenshot claims with perceptual hash, last-4-UTR follow-up, 48-hour "no money received". Payments inbox. Cash with tenant confirmation + cash in hand. Payer aliases. Partial and over-payments.
✅ A real credit email auto-settles the right bill; duplicates and reused screenshots are rejected.

**M6. Receipts, reminders, ledger**
Receipt PDF + `/r/<token>` page + WhatsApp confirmation. Reminder scheduler (pg-boss) per property, skipping paid bills, showing remaining balance for partial. Promise-a-date button. Tenant Ledger, Bills, Receipts, Messages tabs.
✅ Payment → receipt within a minute; unpaid tenants get reminders on schedule; paid tenants get none.

**M7. Overview dashboard and move-out**
Overview (all cards clickable, needs-attention list, automation status). Move-out: notice (from app or WhatsApp) → final bill with proration + final reading → deposit settlement with deductions → owner review → tenant confirms on WhatsApp → final statement PDF → bed vacant, data archived. Property pause. Basic reports: collection, outstanding, tenant ledger (Excel/PDF).
✅ A pilot owner runs a full month and a move-out with no spreadsheet.

### PHASE 2 — Services, complaints, control

- **M8. Complaints** — full Part J, complaint categories and info services, complaint board, emergency and staff-complaint handling, escalation, incidents.
- **M9. On-request services and plans** — laundry, cleaning, food plans, custom services; WhatsApp Flows forms; menu builder adds them automatically; requests board for staff; charges to next bill.
- **M10. WhatsApp Automation area** — automations cards with preview and status, template variants, custom notes, tenant menu preview, notices with audiences, message history with retry. *(Built early on 2026-11-04 at the founder's request: bill/reminder/late-notice/confirmation automations with day + hour schedules, approve-first or automatic sending, notes, live previews, pause/resume, monitor and retry, plus the `/p/<token>` pay page. Still to do here: template variants, tenant menu preview, notices with audiences.)*
- **M11. Roles and controls** — billing staff and maintenance staff roles, permission toggles, audit log UI, manager "Today" screen polish, PWA install prompt, tenant monthly roll call, electricity anomaly alerts.

### PHASE 3 — Insight and growth

- **M12. Expenses and financial reports** — expenses with approval, all reports in H6.11, financial summary, Google Sheets one-way sync (optional).
- **M13. Landing website** — full H8 with real screenshots, pricing, FAQ, demo form.
- **M14. Optional payment gateway** — Razorpay per property, signed webhooks, idempotency, refunds recorded.
- **M15. Smart WhatsApp** — AI intent understanding for Hinglish free text, voice-note transcription, promised-date parsing.

### PHASE 4 — Scale

Own WhatsApp number per PG (Embedded Signup) · Android notification-reader app for bank credits · bank statement upload parsers · Super Admin panel and SaaS subscription billing · hostel-specific features · chains/multi-city.

---

## PART L — EDGE CASES (must be handled)

| Situation | Handling |
|---|---|
| Joins mid-month | Prorated rent and tenant-day electricity share |
| Leaves before cycle end | Final bill prorated to check-out date |
| Room transfer | Close old bed segment, open new; prorate each; history kept |
| Rent change | New rent period from a future date; past bills untouched |
| Service enabled/disabled | Applies from next cycle; past bills untouched |
| Service for selected tenants only | Tenancy service overrides |
| Missing reading | Cycle can't be approved; owner may use estimate (flagged on bill) |
| Wrong reading | Anomaly flag before approval; after issue → credit/debit note |
| Tenant disputes bill | "Question this bill" → billing ticket to owner → note if corrected |
| Correction after issue | Credit/debit note with reason; tenant notified |
| Partial payment | Allocated oldest-first; remaining balance in reminders |
| Overpayment | Advance credit, auto-applied next bill |
| Payment pending/delayed | Bill shows "Confirming"; 48-hour rule for screenshots |
| Duplicate notifications | Unique UTR / idempotent webhooks |
| One payment for many tenants | Owner split + payer alias |
| Same complaint twice | Linked within 24 h |
| Manager unavailable | Auto-reassign after acknowledgement timeout |
| WhatsApp delivery fails | Logged, shown in Needs attention, retry; SMS fallback in Phase 3 |
| Automation paused | Status chip; nothing sent; owner warned on Overview |
| Tenant changes number | Owner/manager updates, or tenant verifies via code to old number or guardian |
| Property stops operating | Status paused: no cycles, no reminders; data kept |
| Tenant leaves without paying | Dues retained on closed tenancy; deposit settlement offsets; marked in reports |
| Cash disputed by tenant | Owner-only ticket; not settled |

**Never lose financial history. Never modify an issued bill.**

---

## PART M — SECURITY, PRIVACY, COMPLIANCE

- RentFlow never holds tenant money (direct UPI goes to the owner; gateway settles to the owner). It records and matches only.
- DPDP Act: tenant consent captured on WhatsApp; ID numbers stored as last 4 digits only; ID documents encrypted in private storage; auto-deletion a configurable period after move-out; tenant can request data/deletion via bot.
- RLS on every table; signed, expiring URLs; public pages use long random tokens and show minimal data (first name, bed, amounts).
- Staff can view but not download ID documents.
- Audit log for every sensitive action.
- Secrets only in environment variables.
- Rate-limit public pages and webhooks; verify every webhook signature.
- Electricity resale rates and GST: show reference information only; owners remain responsible for compliance.

---

## PART N — FINAL ACCEPTANCE (end of Phase 2)

1. Owner registers with phone OTP and creates one or more PGs.
2. Owner adds floors, rooms and beds, and sees occupancy visually.
3. Owner enables, configures and creates custom services per property.
4. Owner/manager adds tenants, assigns beds, transfers rooms, changes rent for future months.
5. Owner configures billing once (due day, send-ahead days, reminders, approval).
6. Manager enters readings with photos; anomalies are flagged.
7. RentFlow calculates correct itemised bills, including prorations and tenant-day electricity splits.
8. Owner reviews and approves; issued bills are locked.
9. Tenants receive bills on WhatsApp and understand them.
10. Tenants pay via UPI from the public page or QR.
11. Bills become paid only after trusted confirmation; screenshots are never proof.
12. Receipts are generated and sent automatically.
13. Ledgers, bills and dashboard totals always agree.
14. Reminders reach only unpaid/partially paid tenants.
15. Cash requires tenant confirmation; staff cash in hand is visible.
16. Tenants use enabled services (laundry, food) from WhatsApp, and the menu matches each property's configuration.
17. Tenants raise complaints with media, get a ticket number and status updates; emergencies and staff complaints are handled as specified.
18. Move-out produces a correct final bill and deposit settlement confirmed by the tenant.
19. Multiple properties stay independent; no owner can see another owner's data.
20. Every screen works on 320-px phones, tablets and desktops with no horizontal scroll.
21. No fake data, dead buttons or placeholder screens in any completed milestone.
