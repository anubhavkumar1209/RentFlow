/**
 * M5: payment capture and matching (CLAUDE.md §8).
 *
 *   bank alert email → parse → bank_credits → matchCredit() → settle / suggest / reject
 *   tenant screenshot → payment_claims (never a payment by itself) → helps matching
 *
 * Only credits from a verified bank sender (DKIM) settle automatically; anything
 * else becomes a suggestion the owner confirms in one tap. Managers can't settle
 * UPI payments (§7.7) — every function here that settles needs the owner or the matcher.
 */
import {
  CLAIM_TIMEOUT_HOURS,
  DUPLICATE_HASH_DISTANCE,
  formatDate,
  hashDistance,
  isFromBank,
  matchCredit,
  parseBankEmail,
  todayInIndia,
  type CreditInput,
  type ISODate,
  type MatchDecision,
} from "@rentflow/core";
import type { Language } from "@rentflow/core";
import { bankCredits, inboundEmails, ledgerEntries, payerAliases, paymentClaims, paymentMatches, type Queryable, type Tx } from "@rentflow/db";
import { and, eq, sql } from "drizzle-orm";
import { can, ForbiddenError, requireOwner, UserError, type Actor } from "../actor";
import { perceptualHash } from "../media";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { openBills, refreshBillStatus } from "./billing";
import { sendMessage } from "./notify";
import { createReceipt } from "./receipts";

// ─── Inbound email ──────────────────────────────────────────────────────────

export interface InboundEmailInput {
  /** The address it was sent to: <slug>-<token>@in.rentflow.app */
  to: string;
  from: string;
  subject: string;
  text: string;
  /** Set by the inbound provider when the sender's DKIM signature checked out. */
  dkimVerified: boolean;
}

export type InboundResult = { status: "unknown_address" } | { status: "unparsed"; emailId: string } | { status: "parsed"; emailId: string; creditId: string | null; decision: MatchDecision["action"] | "duplicate" };

export async function receiveInboundEmail(deps: AppDeps, input: InboundEmailInput): Promise<InboundResult> {
  const local = input.to.trim().toLowerCase().split("@")[0] ?? "";
  const token = local.split("-").at(-1) ?? "";
  const org = await one<{ id: string }>(deps.db, sql`select id from orgs where inbound_email_token = ${token}`);
  if (!org) return { status: "unknown_address" };

  const parsed = parseBankEmail({ from: input.from, subject: input.subject, text: input.text });
  const [email] = await deps.db
    .insert(inboundEmails)
    .values({
      orgId: org.id,
      fromAddress: input.from.slice(0, 500),
      subject: input.subject.slice(0, 500),
      bodyText: input.text.slice(0, 20_000),
      dkimVerified: input.dkimVerified,
      status: parsed ? "parsed" : "unparsed",
      receivedAt: deps.now(),
    })
    .returning({ id: inboundEmails.id });
  if (!email) throw new Error("insert failed");
  if (!parsed) return { status: "unparsed", emailId: email.id };

  const verified = input.dkimVerified && isFromBank(parsed.bank, input.from);
  const result = await ingestCredit(deps, org.id, {
    amountPaise: parsed.amountPaise,
    utr: parsed.utr,
    payerName: parsed.payerName,
    payerVpa: parsed.payerVpa,
    creditedOn: parsed.creditedOn ?? todayInIndia(deps.now()),
    source: "email",
    verified,
    raw: { bank: parsed.bank, emailId: email.id },
  });
  await deps.db.update(inboundEmails).set({ creditId: result.creditId }).where(eq(inboundEmails.id, email.id));
  return { status: "parsed", emailId: email.id, ...result };
}

// ─── Credits & matching ─────────────────────────────────────────────────────

export interface CreditData extends CreditInput {
  source: "email" | "app" | "statement" | "gateway" | "manual";
  verified: boolean;
  raw: Record<string, unknown>;
}

/** Records a bank credit and runs the matcher on it. */
export async function ingestCredit(deps: AppDeps, orgId: string, data: CreditData): Promise<{ creditId: string | null; decision: MatchDecision["action"] | "duplicate" }> {
  if (data.utr) {
    const dup = await one<{ id: string }>(deps.db, sql`select id from bank_credits where org_id = ${orgId} and utr = ${data.utr}`);
    if (dup) return { creditId: null, decision: "duplicate" };
  }
  const [credit] = await deps.db
    .insert(bankCredits)
    .values({
      orgId,
      source: data.source,
      amountPaise: data.amountPaise,
      utr: data.utr,
      payerName: data.payerName,
      payerVpa: data.payerVpa,
      creditedAt: new Date(`${data.creditedOn}T12:00:00+05:30`),
      verified: data.verified,
      raw: data.raw,
    })
    .onConflictDoNothing()
    .returning({ id: bankCredits.id });
  if (!credit) return { creditId: null, decision: "duplicate" };
  const decision = await runMatching(deps, orgId, credit.id);
  return { creditId: credit.id, decision };
}

/** Matches one unmatched credit. Safe to call again (e.g. when a tenant later types their UTR digits). */
export async function runMatching(deps: AppDeps, orgId: string, creditId: string): Promise<MatchDecision["action"]> {
  const receiptIds: string[] = [];
  const action = await deps.db.transaction(async (tx) => {
    const credit = await one<{ amount_paise: unknown; utr: string | null; payer_name: string | null; payer_vpa: string | null; credited_on: string; verified: boolean; status: string }>(
      tx,
      sql`select amount_paise, utr, payer_name, payer_vpa, (credited_at at time zone 'Asia/Kolkata')::date::text as credited_on, verified, status
          from bank_credits where id = ${creditId} and org_id = ${orgId} for update`,
    );
    if (!credit || credit.status !== "unmatched") return "none" as const;
    const input: CreditInput = {
      amountPaise: toPaise(credit.amount_paise),
      utr: credit.utr,
      payerName: credit.payer_name,
      payerVpa: credit.payer_vpa,
      creditedOn: credit.credited_on,
    };
    const ctx = {
      openBills: await openBills(tx, orgId),
      openClaims: (
        await many<{ id: string; tenancy_id: string; utr_last4: string | null; claimed_on: string }>(
          tx,
          sql`select id, tenancy_id, utr_last4, (created_at at time zone 'Asia/Kolkata')::date::text as claimed_on
              from payment_claims where org_id = ${orgId} and status = 'claimed'`,
        )
      ).map((c) => ({ claimId: c.id, tenancyId: c.tenancy_id, utrLast4: c.utr_last4, claimedOn: c.claimed_on })),
      aliases: (await many<{ tenancy_id: string; payer_name: string | null; payer_vpa: string | null }>(tx, sql`select tenancy_id, payer_name, payer_vpa from payer_aliases where org_id = ${orgId}`)).map(
        (a) => ({ tenancyId: a.tenancy_id, payerName: a.payer_name, payerVpa: a.payer_vpa }),
      ),
      knownUtrs: new Set(
        (await many<{ utr: string }>(tx, sql`select utr from bank_credits where org_id = ${orgId} and utr is not null and id <> ${creditId}`)).map((r) => r.utr),
      ),
    };
    const decision = matchCredit(input, ctx);

    if (decision.action === "auto" && credit.verified) {
      receiptIds.push(
        await settleInTx(tx, {
          orgId,
          tenancyId: decision.tenancyId,
          billId: decision.billId,
          amountPaise: input.amountPaise,
          creditId,
          claimId: decision.claimId,
          method: decision.method,
          confirmedBy: null,
          note: null,
        }),
      );
      return "auto" as const;
    }
    if (decision.action === "reject") {
      await tx.update(bankCredits).set({ status: "ignored", raw: sql`coalesce(raw, '{}'::jsonb) || '{"rejected":"duplicate_utr"}'::jsonb` }).where(eq(bankCredits.id, creditId));
      return "reject" as const;
    }
    // Unverified exact matches are still the best guess; the owner confirms them.
    const suggestions =
      decision.action === "auto"
        ? [{ billId: decision.billId, tenancyId: decision.tenancyId, reason: "exact_amount_unverified_sender", differencePaise: 0 }]
        : decision.action === "suggest"
          ? decision.suggestions
          : [];
    await tx.update(bankCredits).set({ suggestions }).where(eq(bankCredits.id, creditId));
    return suggestions.length > 0 ? ("suggest" as const) : ("none" as const);
  });
  for (const id of receiptIds) await deps.jobs.send("receipt.send", { receiptId: id });
  return action;
}

interface SettleInput {
  orgId: string;
  tenancyId: string;
  billId: string;
  amountPaise: number;
  creditId: string | null;
  claimId: string | null;
  method: "unique_amount" | "utr_last4" | "manual";
  confirmedBy: string | null;
  note: string | null;
}

/** Records the payment: match → ledger payment → statuses → receipt. Returns the receipt id. */
async function settleInTx(tx: Tx, input: SettleInput): Promise<string> {
  const [match] = await tx
    .insert(paymentMatches)
    .values({
      orgId: input.orgId,
      creditId: input.creditId,
      billId: input.billId,
      claimId: input.claimId,
      method: input.method,
      amountPaise: input.amountPaise,
      confirmedBy: input.confirmedBy,
      note: input.note,
    })
    .returning({ id: paymentMatches.id });
  if (!match) throw new Error("insert failed");
  await tx.insert(ledgerEntries).values({
    orgId: input.orgId,
    tenancyId: input.tenancyId,
    type: "payment",
    amountPaise: -input.amountPaise,
    refType: "payment_match",
    refId: match.id,
    createdBy: input.confirmedBy,
  });
  if (input.creditId) await tx.update(bankCredits).set({ status: "matched", suggestions: [] }).where(eq(bankCredits.id, input.creditId));
  const claimId =
    input.claimId ??
    (await one<{ id: string }>(tx, sql`select id from payment_claims where tenancy_id = ${input.tenancyId} and status = 'claimed' order by created_at limit 1`))?.id ??
    null;
  if (claimId) {
    await tx.update(paymentClaims).set({ status: "matched" }).where(eq(paymentClaims.id, claimId));
    if (!input.claimId) await tx.update(paymentMatches).set({ claimId }).where(eq(paymentMatches.id, match.id));
  }
  await refreshBillStatus(tx, input.tenancyId);
  return createReceipt(tx, { orgId: input.orgId, tenancyId: input.tenancyId, amountPaise: input.amountPaise, paymentMatchId: match.id });
}

// ─── Confirming payments by hand ────────────────────────────────────────────

/**
 * Who may confirm a UPI payment by hand: the owner, or any manager of the
 * tenant's PG (founder's decision of 2026-11-04, replacing spec Part E10's
 * "managers can't settle UPI"). Each confirmation records who made it
 * (payment_matches.confirmed_by) and is written to the audit log by trigger.
 */
async function requireSettler(db: Queryable, actor: Actor, tenancyId: string): Promise<void> {
  const row = await one<{ property_id: string }>(
    db,
    sql`select r.property_id from tenancies tc join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id where tc.id = ${tenancyId} and tc.org_id = ${actor.orgId}`,
  );
  if (!row || !can(actor, row.property_id)) throw new ForbiddenError("You can only confirm payments for the PGs you manage.");
}

/** One-tap confirm of a suggested (or any chosen) bill for an unmatched credit. Remembers the payer. */
export async function confirmCreditMatch(deps: AppDeps, actor: Actor, creditId: string, billId: string): Promise<void> {
  const target = await one<{ tenancy_id: string }>(deps.db, sql`select tenancy_id from bills where id = ${billId} and org_id = ${actor.orgId}`);
  if (!target) throw new ForbiddenError();
  await requireSettler(deps.db, actor, target.tenancy_id);
  const receiptId = await deps.db.transaction(async (tx) => {
    const credit = await one<{ amount_paise: unknown; status: string; payer_name: string | null; payer_vpa: string | null }>(
      tx,
      sql`select amount_paise, status, payer_name, payer_vpa from bank_credits where id = ${creditId} and org_id = ${actor.orgId} for update`,
    );
    if (!credit) throw new ForbiddenError();
    if (credit.status !== "unmatched") throw new UserError("This credit is already matched or ignored.");
    const bill = await one<{ tenancy_id: string }>(tx, sql`select tenancy_id from bills where id = ${billId} and org_id = ${actor.orgId}`);
    if (!bill) throw new ForbiddenError();
    if (credit.payer_name || credit.payer_vpa) {
      const known = await one<{ id: string }>(
        tx,
        sql`select id from payer_aliases where tenancy_id = ${bill.tenancy_id}
            and coalesce(lower(payer_vpa), '') = coalesce(lower(${credit.payer_vpa}), '') and coalesce(lower(payer_name), '') = coalesce(lower(${credit.payer_name}), '')`,
      );
      if (!known) await tx.insert(payerAliases).values({ orgId: actor.orgId, tenancyId: bill.tenancy_id, payerName: credit.payer_name, payerVpa: credit.payer_vpa });
    }
    return settleInTx(tx, {
      orgId: actor.orgId,
      tenancyId: bill.tenancy_id,
      billId,
      amountPaise: toPaise(credit.amount_paise),
      creditId,
      claimId: null,
      method: "manual",
      confirmedBy: actor.userId,
      note: null,
    });
  });
  await deps.jobs.send("receipt.send", { receiptId });
}

/** Owner or manager records money that reached the bank without an alert (or paid some other way). */
export async function manualSettle(
  deps: AppDeps,
  actor: Actor,
  input: { tenancyId: string; amountPaise: number; utr: string | null; note: string; receivedOn: ISODate },
): Promise<void> {
  await requireSettler(deps.db, actor, input.tenancyId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new UserError("Enter the amount received.");
  const utr = input.utr?.replace(/\s/g, "") || null;
  const receiptId = await deps.db.transaction(async (tx) => {
    const bill = await one<{ id: string }>(
      tx,
      sql`select b.id from bills b join billing_cycles c on c.id = b.cycle_id
          where b.tenancy_id = ${input.tenancyId} and b.org_id = ${actor.orgId} and c.status <> 'draft'
          order by c.approved_at desc limit 1`,
    );
    if (!bill) throw new UserError("This tenant has no approved bill yet.");
    let creditId: string | null = null;
    if (utr) {
      const dup = await one<{ id: string }>(tx, sql`select id from bank_credits where org_id = ${actor.orgId} and utr = ${utr}`);
      if (dup) throw new UserError("A payment with this UTR is already recorded.");
      const [credit] = await tx
        .insert(bankCredits)
        .values({ orgId: actor.orgId, source: "manual", amountPaise: input.amountPaise, utr, creditedAt: new Date(`${input.receivedOn}T12:00:00+05:30`), verified: false, raw: { note: input.note } })
        .returning({ id: bankCredits.id });
      creditId = credit?.id ?? null;
    }
    return settleInTx(tx, {
      orgId: actor.orgId,
      tenancyId: input.tenancyId,
      billId: bill.id,
      amountPaise: input.amountPaise,
      creditId,
      claimId: null,
      method: "manual",
      confirmedBy: actor.userId,
      note: input.note.trim() || null,
    });
  });
  await deps.jobs.send("receipt.send", { receiptId });
}

export async function ignoreCredit(deps: AppDeps, actor: Actor, creditId: string): Promise<void> {
  requireOwner(actor);
  await deps.db
    .update(bankCredits)
    .set({ status: "ignored", suggestions: [] })
    .where(and(eq(bankCredits.id, creditId), eq(bankCredits.orgId, actor.orgId), eq(bankCredits.status, "unmatched")));
}

/** From the "unparsed" queue: the owner types in what the email says. */
export async function addCreditFromEmail(
  deps: AppDeps,
  actor: Actor,
  emailId: string,
  input: { amountPaise: number; utr: string | null; payerName: string | null; creditedOn: ISODate },
): Promise<void> {
  requireOwner(actor);
  const email = await one<{ id: string }>(deps.db, sql`select id from inbound_emails where id = ${emailId} and org_id = ${actor.orgId}`);
  if (!email) throw new ForbiddenError();
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new UserError("Enter the amount.");
  // Typed by hand, so never auto-settled: it lands as a suggestion to confirm.
  const result = await ingestCredit(deps, actor.orgId, { ...input, payerVpa: null, utr: input.utr?.trim() || null, source: "manual", verified: false, raw: { emailId } });
  if (result.decision === "duplicate") throw new UserError("A credit with this UTR is already recorded.");
  await deps.db.update(inboundEmails).set({ status: "parsed", creditId: result.creditId }).where(eq(inboundEmails.id, emailId));
}

export async function ignoreEmail(deps: AppDeps, actor: Actor, emailId: string): Promise<void> {
  requireOwner(actor);
  await deps.db.update(inboundEmails).set({ status: "ignored" }).where(and(eq(inboundEmails.id, emailId), eq(inboundEmails.orgId, actor.orgId)));
}

// ─── Screenshot claims ──────────────────────────────────────────────────────

/** Stores a tenant's payment screenshot. Rejects images already used (exact or near-duplicate). */
export async function saveScreenshotClaim(
  deps: AppDeps,
  input: { orgId: string; tenancyId: string; bytes: Buffer; contentType: string },
): Promise<{ duplicate: boolean }> {
  const hash = await perceptualHash(input.bytes);
  const existing = await many<{ image_hash: string }>(deps.db, sql`select image_hash from payment_claims where org_id = ${input.orgId}`);
  if (existing.some((e) => hashDistance(e.image_hash, hash) <= DUPLICATE_HASH_DISTANCE)) return { duplicate: true };
  const key = `${input.orgId}/claims/${input.tenancyId}/${Date.now()}.${input.contentType.includes("png") ? "png" : "jpg"}`;
  await deps.files.put(key, input.bytes, input.contentType);
  const [row] = await deps.db
    .insert(paymentClaims)
    .values({ orgId: input.orgId, tenancyId: input.tenancyId, screenshotRef: key, imageHash: hash })
    .onConflictDoNothing()
    .returning({ id: paymentClaims.id });
  if (!row) return { duplicate: true };
  await rematchRecent(deps, input.orgId);
  return { duplicate: false };
}

export async function setClaimUtrLast4(deps: AppDeps, orgId: string, tenancyId: string, last4: string): Promise<void> {
  if (!/^\d{4}$/.test(last4)) return;
  const claim = await one<{ id: string }>(
    deps.db,
    sql`select id from payment_claims where tenancy_id = ${tenancyId} and status = 'claimed' order by created_at desc limit 1`,
  );
  if (!claim) return;
  await deps.db.update(paymentClaims).set({ utrLast4: last4 }).where(eq(paymentClaims.id, claim.id));
  await rematchRecent(deps, orgId);
}

/** Re-runs matching on recent unmatched credits (a new claim or UTR may resolve them). */
async function rematchRecent(deps: AppDeps, orgId: string): Promise<void> {
  const credits = await many<{ id: string }>(
    deps.db,
    sql`select id from bank_credits where org_id = ${orgId} and status = 'unmatched' and credited_at > ${new Date(deps.now().getTime() - 10 * 86_400_000)}`,
  );
  for (const c of credits) await runMatching(deps, orgId, c.id);
}

/** Daily: screenshots with no money after 48 hours are flagged; tenant and owner are told (§8). */
export async function flagStaleClaims(deps: AppDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - CLAIM_TIMEOUT_HOURS * 3_600_000);
  const stale = await many<{ id: string; org_id: string; tenancy_id: string; created_on: string; phone: string; language: Language; property_name: string; tenant_name: string; room: string; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select pc.id, pc.org_id, pc.tenancy_id, (pc.created_at at time zone 'Asia/Kolkata')::date::text as created_on,
               t.phone, t.language, p.name as property_name, t.name as tenant_name, r.number || b.label as room, p.wa_phone_number_id
        from payment_claims pc join tenancies tc on tc.id = pc.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where pc.status = 'claimed' and pc.flagged_at is null and pc.created_at < ${cutoff}`,
  );
  for (const c of stale) {
    await deps.db.update(paymentClaims).set({ flaggedAt: deps.now() }).where(eq(paymentClaims.id, c.id));
    await sendMessage(
      deps,
      { phone: c.phone, orgId: c.org_id, tenancyId: c.tenancy_id, phoneNumberId: c.wa_phone_number_id },
      { kind: "template", name: "rf_claim_unmatched", language: c.language, variables: [c.property_name, formatDate(c.created_on)] },
    ).catch(() => undefined);
    await alertOwners(deps, c.org_id, c.property_name, `No money received yet for the payment screenshot ${c.tenant_name} (${c.room}) sent on ${formatDate(c.created_on)}.`);
  }
  return stale.length;
}

/** WhatsApp alert to every owner of the org (rf_staff_alert template). */
export async function alertOwners(deps: AppDeps, orgId: string, propertyName: string, text: string): Promise<void> {
  const owners = await many<{ phone: string }>(
    deps.db,
    sql`select u.phone from org_members m join users u on u.id = m.user_id where m.org_id = ${orgId} and m.role = 'owner'`,
  );
  for (const o of owners) {
    await sendMessage(deps, { phone: o.phone, orgId }, { kind: "template", name: "rf_staff_alert", language: "en", variables: [propertyName, text.replace(/\s+/g, " ")] }).catch(() => undefined);
  }
}

