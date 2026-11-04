# RentFlow

WhatsApp-first rent collection for PGs and hostels. The full product spec is in [CLAUDE.md](CLAUDE.md); decisions are logged in [docs/DECISIONS.md](docs/DECISIONS.md).

```
apps/web       Next.js owner/manager web app (PWA)
apps/api       Fastify API: bot webhook, email inbound, workers (from M4)
packages/core  Pure business logic (money, phone; billing etc. from M3) — no DB/network
packages/db    Drizzle schema, SQL migrations (incl. RLS), RLS tests
```

## Day-to-day commands

```bash
pnpm install
pnpm test          # unit tests + RLS tests (in-process Postgres, nothing to set up)
pnpm lint
pnpm typecheck
pnpm dev:web       # http://localhost:3000 (needs apps/web/.env.local, see below)
pnpm dev:api       # http://localhost:4000/health
```

## First-time setup with Supabase

1. **Create the project** at supabase.com → New project → Region **Mumbai (ap-south-1)**. Save the database password.
2. **Run the migrations.** Copy `packages/db/.env.example` to `packages/db/.env` and paste the *Session pooler* connection string (dashboard → Connect). Then:
   ```bash
   pnpm db:migrate
   ```
3. **Turn on phone login.** Dashboard → Authentication → Sign In / Providers → Phone → enable.
   - Real SMS needs an SMS provider (Twilio, MessageBird, Vonage, Textlocal…). For Indian numbers, the provider also needs DLT registration.
   - For testing without SMS, add **test phone numbers with fixed OTPs** on the same screen (e.g. `919876500001=123456`).
4. **Configure the web app.** Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the project URL and **publishable** (or legacy anon) key from Project Settings → API. Never put the secret/service-role key there.
5. `pnpm dev:web`, open http://localhost:3000, log in with your phone, and create your business.

## Changing the database

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate` writes a new migration in `packages/db/migrations/`.
3. For new tables, add their RLS policies and grants in a new custom migration (`pnpm --filter @rentflow/db exec drizzle-kit generate --custom --name <name>`), and add cases to `packages/db/test/rls.test.ts`.

CI fails if `schema.ts` and the migrations disagree.

## Try it without any accounts (demo mode)

```bash
pnpm demo        # http://localhost:3000 — login code is always 123456
```

Everything runs on your computer: the real database rules, billing, matching and bot, with stand-ins for the paid services. Open **🧪 Demo tools** to see each tenant's WhatsApp chat (and reply as them), send a fake bank credit alert, or run the daily jobs (drafts, reminders) "as if today were" any date. Data lives in `%TEMP%\rentflow-demo-db` and `%TEMP%\rentflow-demo-files`; delete both (with the demo stopped) to start over.

## Going live (Phase 1)

| Piece | Where | Needs |
|---|---|---|
| Web app (`apps/web`) | Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `RECEIPT_SIGNING_SECRET` |
| API + workers (`apps/api`) | any Node host with Chromium | everything in `apps/api/.env.example` |
| WhatsApp | Meta Business → WhatsApp Cloud API | create the 8 templates in `packages/core/src/templates.ts` (same names, bodies, buttons); webhook URL `https://<api>/webhooks/whatsapp` |
| Bank alerts | an inbound-email provider (Postmark/SendGrid/Mailgun) | POST to `https://<api>/inbound/email` with header `x-inbound-secret`, body `{to, from, subject, text, dkimVerified}` |
| Storage | Supabase Storage | a **private** bucket named `rentflow-private` |
