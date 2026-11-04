# Decisions

One line of reasoning per non-obvious decision. Newest milestone at the bottom.

## M1 — Foundation

### Tooling
- **TypeScript pinned to 6.0.x** (not 7): typescript-eslint supports only `<6.1`.
- **Relative imports have no `.js` extension**: Next's Turbopack doesn't map `./x.js` to `./x.ts` inside workspace packages. All packages use `moduleResolution: Bundler`.
- **Next.js 16 `proxy.ts`** (the new name for `middleware.ts`) refreshes the Supabase session cookie and redirects logged-out visitors to `/login`.
- **pnpm `allowBuilds: esbuild`**: pnpm blocks dependency install scripts by default; esbuild (used by tsx and drizzle-kit) needs its binary.

### Database & security
- **RLS tests run on PGlite** (real Postgres compiled to WASM, in-process): no Docker on the dev machine and no DB service in CI, yet the tests run the exact migration files. Only Supabase's roles and `auth.uid()`/`auth.jwt()` are stubbed (`packages/db/test/harness.ts`).
- **Schema in Drizzle; RLS/grants/functions in a hand-written SQL migration** (`0001_rls_and_functions.sql`): policies read better as SQL, and one file shows the whole access model.
- **Composite `(id, org_id)` foreign keys** on every parent/child link: the database itself guarantees a room, bed or tenancy can never point at another org's rows, even if RLS has a bug.
- **Grants start from zero**: Supabase grants everything to `anon`/`authenticated` by default; we revoke all and grant only what each policy is written for. `anon` gets nothing.
- **Policy helpers are `SECURITY DEFINER` functions in a `private` schema**: avoids RLS recursion on `org_members`, and the Supabase API doesn't expose that schema.
- **SELECT policies check `is_org_owner(org_id)` first**: cheap, and required for `INSERT … RETURNING` (helpers that look the row up by id can't see a row inserted in the same statement).
- **Managers are read-only in M1**, scoped to properties in `user_property_access`. Manager writes (add/check-out tenant, meter readings) arrive as scoped database functions in M2/M3 so business rules are enforced atomically.
- **Owner signup is one function, `create_owner_org()`**: creates the `users` row, org and owner membership in a single transaction, so there's never an org without an owner. It refuses if the user already owns an org (stops double-submit duplicates).
- **An org must keep at least one owner**: trigger blocks deleting/demoting the last owner.
- **Audit log written by triggers**, not app code, so nothing can skip it. Room/bed *inserts* aren't audited (bulk generation would flood it); their updates/deletes are. `audit_log` has no grants beyond SELECT (owners only) — it's append-only.
- **`audit_log.org_id` has no FK to `orgs`**: audit rows written during an org's cascade-delete would otherwise fail.
- **`tenancies` → `tenants`/`beds` FKs are `NO ACTION`, not `RESTRICT`**: a tenant or bed with history can't be deleted alone, but deleting a whole org still cascades.
- **A bed can hold at most one `active`/`notice` tenancy** (partial unique index).
- **Users can edit their name/email but not `phone`** (column-level grant): phone is the login identity from Supabase Auth.

### Data model details (within §6)
- **`users` has no `org_id`**: a person can belong to several orgs; membership is in `org_members`. `users.id` = Supabase `auth.users.id`.
- **Added `tenants.language` (`en`/`hi`, default `en`)**: §9 requires storing the tenant's language preference on the tenant.
- **`tenants` unique on `(org_id, phone)`**: the WhatsApp number is the identity; the same person may be a tenant in two different orgs.
- **`properties.due_day` is 1–28**: every month has those days, so due dates never need special-casing.
- **`properties.reminder_rules` default `{"offsets_days": [-2, 0, 3, 7]}`** (§9 default schedule).
- **`rooms.floor` is a number, 0 = ground floor**; `rooms.number` is text ("101", "G2").
- **`rooms.meter_id` has no FK yet**: the `meters` table arrives in M3.
- **Money columns are `bigint` read as JS `number`**: exact for any amount up to ~₹90 lakh crore; avoids BigInt friction in the UI.

### App
- **The web app talks to Supabase directly (supabase-js) under RLS**: every query runs as the logged-in user, so the database enforces access. Drizzle is used for schema/migrations and will be used by `apps/api` for server-side work.
- **Phone numbers without a country code are treated as Indian mobiles** (`normalizePhone` in `packages/core`); everything is stored in E.164.
- **PWA = web manifest + SVG icon for now**: enough for "Add to Home Screen"/install on Chrome. Offline support is part of M11 (manager PWA polish).
- **Demo mode (`pnpm demo`)** lets the founder try the app without a Supabase account: fixed OTP `123456`, data in a local PGlite under the OS temp folder (not OneDrive), using the same migrations, RLS and `create_owner_org()`. The demo session cookie is unsigned, so demo mode refuses to run in production builds.
- **Hindi UI deferred to M2**: M1 has three screens; translations are cheaper to add once the M2 screens exist.

## M2–M7 — Phase 1 (built together at the founder's request)

### Architecture
- **`packages/server` holds all server-side services** (setup, billing, payments, cash, bot, receipts, check-out, daily jobs). `apps/web` calls them from server actions; `apps/api` from the WhatsApp webhook, the inbound-email endpoint and pg-boss workers. Same code in demo, tests and production.
- **One data path for web reads: Drizzle under RLS** (`asUser` = `set local role authenticated` + JWT claims, exactly like Supabase's API). Replaces M1's supabase-js queries so demo and production run identical SQL. Supabase Auth is still used for login.
- **App users can only READ the Phase 1 tables.** Every write goes through a service that checks the role first (`requireOwner` / `requireProperty`) and runs as the DB owner. Money rows can't be forged from a browser even if a policy is wrong.
- **External services are behind small interfaces** (`WhatsAppSender`, `FileStore`, `PdfRenderer`, `JobQueue`, `AuthAdmin`). Demo/tests: logged messages, local files, in-process jobs. Production: Meta Cloud API, Supabase Storage, pg-boss, Supabase Auth admin.
- **Timestamps that are compared with ledger times use the database clock** (`approved_at = now()`).

### Billing (please confirm — money rules)
- **Cycle P bills rent for month P (in advance) and electricity used in month P−1** (reading end of P−2 → end of P−1), split by tenant-days in P−1. Due date = due_day of P. Matches common PG practice (rent upfront, power in arrears); the §7 worked example passes as a pure calculation.
- **Rent is billed by date range** (`bill_lines.period_start/end`), so a mid-month joiner's unbilled days are picked up on the next bill, each month prorated by its own length. Tenants older than RentFlow start billing from the first cycle, not their check-in.
- **Previous dues are carried into each new bill** (a `previous_due` line marked `carried`); approval writes only the non-carried lines to the ledger. Paying the latest bill therefore settles the oldest money first (§7.8).
- **Fixed charges are not prorated** for partial months (as in the §7 example: Anmol pays full Wi-Fi).
- **Owners/managers edit a draft only by adding lines** (charges; owners also discounts). Calculated lines can't be edited, so a rebuild after a reading change never loses an edit.
- **Unique payable (§7.5):** total rounded down to the rupee + first free 1–99 paise among the property's open bills; if all 99 are taken, the rupee steps down. Consequence: when a total has paise (electricity shares often do), the tenant may pay up to 99 paise *less* than the total and that remainder carries to next month (e.g. ₹0.30).
- **Late fee:** optional flat amount per property, added to the next draft if the previous bill is unpaid `grace_days` after its due date.
- **Meter readings are whole units; a photo is required.** Readings used by an approved cycle are locked.
- **Approved cycles are locked in the database** (trigger on `bill_lines`), and the ledger rejects UPDATE/DELETE even for the DB owner (trigger), except during a whole-org delete.

### Payments
- **Bank emails auto-settle only when DKIM-verified from the bank's own domain.** Hand-forwarded or spoofed emails become suggestions the owner confirms in one tap. Prevents anyone who learns the inbound address from marking bills paid.
- **Per-org inbound address** `<slug>-<token>@<INBOUND_EMAIL_DOMAIN>`; the token (`orgs.inbound_email_token`) identifies the org.
- **Screenshot reuse** is caught with a 64-bit dHash (sharp); ≤ 4 differing bits = same image. No OCR (§8).
- **Owner "manual settle"** records a payment_match without a credit (optionally with a UTR, which then blocks a duplicate credit).
- **Cash** becomes a payment only after the tenant taps "Correct" on WhatsApp; "Not correct" alerts the owner.

### Bot & messages
- Business-initiated messages are the 8 templates in `packages/core/src/templates.ts` (also seeded into `message_templates`; a test keeps them identical). They must be created in Meta with the same names/bodies before going live.
- The bill template carries the QR as its header image and a one-line breakdown (WhatsApp variables can't contain newlines); "Pay now" sends QR + UPI link + the pay-only warning.
- Welcome template asks for DPDP consent ("I agree" → `tenants.consent_at`).
- Reminders are de-duplicated per bill and offset via `message_log.payload`.

### Data model additions (all small; listed for the founder)
- `orgs.inbound_email_token`, `orgs.receipt_seq`; `tenancies.settlement` (jsonb); `meter_readings.kind/reading_date`; `billing_cycles.kind/tenancy_id/due_date/anomalies`; `bill_lines.period_start/period_end/carried/manual/sort`; `bank_credits.verified/suggestions`; `payment_claims.flagged_at`; `payment_matches.amount_paise/note`; `cash_entries.received_on/disputed_at/note`; `receipts.tenancy_id/amount_paise/sent_at`; `message_log.phone/tenancy_id/org_id`; new table `inbound_emails` (the "unparsed" queue).
- Phase 2 tables (service plans/requests, tickets) are not created yet.

### Deferred
- Hindi in the web app (the bot and templates are already English + Hindi).
- Floor/building meters are stored but only room meters are billed.
- Automatic deletion of ID documents after check-out (TODO in `checkout.ts`).
- Offline PWA (M11).

## Spec v2 — M1 (foundation and app shell)

The founder replaced the spec with a larger one (now `CLAUDE.md`; the old one is `docs/SPEC_V1.md`). Phase 1 of v1 was already built, so v2 is adopted by **upgrading the working app milestone by milestone**, not rewriting it.

- **`packages/ui` is the design system:** H2 tokens as Tailwind v4 theme variables (`primary`, `success`, `warning`, `danger`, `info`, `ink`, `ink-2`, `muted`, `page`, `card`, `line`, radii, card shadow) + shadcn-style components on Radix (Dialog, ConfirmDialog, Drawer, DropdownMenu), Sonner toasts, Lucide icons. Components are copied/owned (shadcn approach), not installed via the shadcn CLI.
- **Old `brand-*` colour names are aliased to the new primary** so screens built for v1 adopt the new palette; raw palette classes in existing screens were mapped to tokens.
- **Selects are native `<select>`** styled like the other inputs: best on low-end Android, fully accessible.
- **Tables become stacked cards on phones** via `DataTable`, which labels each cell with its column heading (no horizontal scroll at 320 px).
- **i18n: next-intl without locale routes.** Language is a personal setting (`users.language` + `rf_lang` cookie), chosen at signup, in Settings, in the profile menu, or on the login page. M1 translates the shell, login, signup and settings; other screens get translated as each milestone rebuilds them.
- **Navigation shows only screens that exist.** Complaints (M8), WhatsApp Automation (M10) and Expenses (M12) appear when built; until then the owner's mobile tabs are Overview · Tenants · Payments · Bills · More (spec: Complaints in place of Bills).
- **Property switcher** stores the choice in a cookie; Overview, Tenants and Rooms & Beds follow it. A stale or forbidden id falls back to "All properties".
- **Notifications bell** shows real "needs attention" counts (drafts, unmatched payments, unread bank emails, disputed/pending cash, failed WhatsApp, screenshots without money), read under RLS so managers only see what they may.
- **`floors` table added; `rooms.floor` replaced by `rooms.floor_id`.** Existing rooms were moved onto generated floors ("Floor 3", "Ground floor") by the migration. `rooms.property_id` is kept alongside `floor_id` so room RLS needs no join.
- **New columns from Part D:** `users.language`, `org_members.active` (inactive members lose access; RLS helpers check it), roles `billing_staff` / `maintenance_staff` (scoped like managers until M11), `properties.city/contact_phone/status/timezone` (existing properties set to `active`), `tenants.email/status`, `tenancies.billing_start`.
- **Kept from v1 for now (to be moved in the milestone that owns them):** billing settings stay on `properties` (→ `property_billing_settings` in M3); rent stays on `tenancies` (→ `tenancy_rent_periods` in M2); manager access table keeps the v1 name `user_property_access` (= v2 `member_permissions`); bed status `blocked` is shown as "Unavailable" and `reserved` arrives with the reserve action in M2.
- **v2 answers an open v1 money question:** Part E8 adds the unique-amount suffix as a visible "Payment ID adjustment" line so the bill total equals the amount to pay. The v1 code instead lets the tenant pay up to 99 paise less and carries the difference; this is changed in M3.
- **Simple landing page at `/` before M13** (the spec allows a pilot version): RentFlow's own angle ("every rupee confirmed by your bank"), Lucide icons, EN/HI, no invented numbers or testimonials. Redesigned again on 2026-11-04 at the founder's request for a simpler, more premium and more informative page: white and teal, Inter headlines, a tilted 3D product preview with a WhatsApp chat floating over it, then problems, how it works, four feature sections, a feature grid, old-way-vs-RentFlow table, security, FAQ and CTA. Previews are drawn in code from RentFlow's design tokens (sharp, no image weight for fast loading) and labelled "Example data"; the billing example is calculated live with packages/core (the Part E Room 303 case). Real screenshots replace them in M13. Following Google's guidance: clear value proposition above the fold, one repeated primary CTA, mobile-first, no layout shift, FAQPage + SoftwareApplication JSON-LD. Motion is CSS only and off for reduced-motion users; Hindi gets no letter-spacing. Logged-in visitors are redirected to their app. Pricing, legal pages and demo form wait for M13.
- **Logo: "Confirmed Home" (founder's choice, 2026-11-04)** — house + tick on teal; primary colour changed from blue `#2F5BEA` to teal `#0F766E` (also distinguishes RentFlow from a blue/navy competitor). CLAUDE.md H2 updated.
- **Logo motion "Draw & confirm"** is CSS on an inline SVG (`pathLength=100` dash animation + pop): once per page load and on hover/focus of the logo link; static favicon; disabled under `prefers-reduced-motion`.

## WhatsApp Automation (M10, built early on 2026-11-04 at the founder's request)

- **Built ahead of M2–M9** because the founder asked for it; it sits on the Phase 1 billing, matching and receipts that already exist. Template variants, the tenant-menu preview and notices with audiences are still M10 work.
- **Managers may confirm UPI payments** for the PGs they manage (founder's decision; spec Part E10 changed). `manualSettle` and `confirmCreditMatch` check "owner, or manager of the tenant's PG"; the confirmer is stored in `payment_matches.confirmed_by` and the audit trigger logs it. The Payments inbox (unmatched bank credits) stays owner-only because credits aren't tied to a PG until matched; managers confirm from the tenant's page.
- **No tenant-typed transaction ID** (founder's decision). After paying, the tenant can send a screenshot, which is only a hint for matching and never proof.
- **`automations` table** (one row per PG and automation; no row = on with defaults) holds on/off, the owner's note and the schedule. Schedules are parsed and checked in `packages/core/src/automation.ts`. `properties.reminder_rules` is no longer used (TODO(M11): drop).
- **Bill schedule:** "a fixed day of the month" or "N days before the due date", at an hour from 6 AM to 10 PM India time. The default is the spec's 7 days before the due date at 9 AM. A missed bill day is caught up on any hour until the due date.
- **"Approve before sending" defaults to on.** When it's off, the run approves and sends by itself (cycle `approved_by` is null), except when meter readings are missing or flagged; then the owner is alerted to review.
- **The scheduler runs hourly** (pg-boss `0 * * * *`, still the `daily.run` job) and fires each automation at or after its owner's hour. Every check is idempotent. A failed reminder isn't retried automatically every hour; the owner retries it from "Recent messages".
- **Owner's note:** one line, at most 120 characters, added as the last variable of the Meta-approved templates (`rf_bill`, `rf_reminder`, `rf_payment_received`). Owners can't write free-form messages (spec G1). Templates must be re-submitted to Meta with the new variable counts and the "Pay now" URL button (`<APP_URL>/p/{{1}}`).
- **Pay page `/p/<token>`:** an HMAC-signed bill id (the same scheme as receipt links), public, with the tenant's first name only. It has a `upi://` button (Android opens its app chooser), PhonePe, Google Pay and Paytm deep links (`phonepe://`, `tez://upi/pay`, `paytmmp://`, for iPhones), a QR, a copyable UPI ID and number, and a screenshot upload. Partly paid bills ask for the remaining balance. The page shows "Paid" only from the bill's confirmed status. TODO: rate-limit at the edge (spec M).
- **Pause all** (`properties.automations_paused`) stops bills, reminders and confirmations on WhatsApp. Approved bills and receipts unsent in the last 7 days go out on Resume. A PG paused in My PGs counts as paused too.
- **Reminder fix:** the "already sent?" check used to require `status = 'sent'`, so a reminder whose status had moved on to `delivered`/`read` could be sent again. It now counts any earlier attempt.

## Indian languages (2026-11-04)

- **English + 12 Indian languages** (founder: "all languages spoken in India", narrowed to the 12 most widely spoken): Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu, Assamese. The list lives in `packages/core/src/languages.ts`; the `language` enum matches it. Spec Part C (i18n) and G1 updated.
- **Translations are drafts; native speakers review them before launch** (founder's choice). Every language except English and Hindi is marked `needsReview`. No language may go live, or have its WhatsApp templates submitted to Meta, until a native speaker has checked it.
- **Tenant text lives in one pack per language** (`packages/core/src/i18n/<code>.ts`): bot replies, WhatsApp templates, reminder wording, default notes, payment line and pay page. TypeScript makes every pack complete, and `i18n.test.ts` checks placeholders, WhatsApp's 20/24/72-character limits and that values survive.
- **WhatsApp languages:** Meta's template list (developers.facebook.com, "Supported Languages") has all of them except Odia and Assamese. Those tenants get Hindi on WhatsApp (`LANGUAGES[l].whatsapp`); their pay page and app stay in their own language. 0010 seeds the template copies for the 9 new WhatsApp languages.
- **Owner app:** `messages/<lang>.json` for every language, layered over English so an untranslated line shows in English rather than as a key; `apps/web/test/messages.test.ts` checks keys and placeholders. Most inner owner screens (billing, tenants, payments, readings…) still have English written in the code, for Hindi too: they need their text moved into the catalogs before they can be translated (next step).
- **Fonts and direction:** one Noto font per script, not preloaded (a page downloads only the scripts it shows); Urdu uses Noto Nastaliq and `dir="rtl"`. Layouts use left/right utilities in places, so some Urdu screens may need small mirroring fixes after review.
- **The bot understands keywords in every language** (a substring match; `\b` doesn't work outside ASCII), not only the tenant's own.
- **Migration 0009 recreates the `language` type** instead of `ALTER TYPE … ADD VALUE`: migrations run in one transaction, and a value added that way can't be used (by 0010) until committed. `migrations-upgrade.test.ts` covers upgrading an existing database.
