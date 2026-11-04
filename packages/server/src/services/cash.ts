/**
 * M5: cash. Manager records → tenant confirms on WhatsApp → payment + receipt.
 * Until the tenant confirms, cash is not a payment (CLAUDE.md §7.6).
 */
import { formatDate, formatINR, isISODate } from "@rentflow/core";
import type { Language } from "@rentflow/core";
import { cashEntries, ledgerEntries } from "@rentflow/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ForbiddenError, requireOwner, requireProperty, UserError, type Actor } from "../actor";
import type { AppDeps } from "../ports";
import { one, toPaise } from "../sql";
import { refreshBillStatus } from "./billing";
import { sendMessage } from "./notify";
import { alertOwners } from "./payments";
import { createReceipt } from "./receipts";

export async function recordCash(
  deps: AppDeps,
  actor: Actor,
  input: { tenancyId: string; amountPaise: number; receivedOn: string; note: string },
): Promise<string> {
  const t = await one<{ property_id: string; status: string }>(
    deps.db,
    sql`select r.property_id, tc.status from tenancies tc join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        where tc.id = ${input.tenancyId} and tc.org_id = ${actor.orgId}`,
  );
  if (!t) throw new ForbiddenError();
  requireProperty(actor, t.property_id, "record_cash");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new UserError("Enter the cash amount.");
  if (!isISODate(input.receivedOn)) throw new UserError("Enter the date the cash was received.");
  const [row] = await deps.db
    .insert(cashEntries)
    .values({ orgId: actor.orgId, tenancyId: input.tenancyId, amountPaise: input.amountPaise, receivedOn: input.receivedOn, recordedBy: actor.userId, note: input.note.trim() || null })
    .returning({ id: cashEntries.id });
  if (!row) throw new Error("insert failed");
  await deps.jobs.send("cash.confirm.send", { cashEntryId: row.id });
  return row.id;
}

/** Job: "Manager <name> recorded ₹X cash from you on <date>. [Correct] [Not correct]" */
export async function sendCashConfirmation(deps: AppDeps, cashEntryId: string): Promise<void> {
  const c = await one<{ org_id: string; tenancy_id: string; amount_paise: unknown; received_on: string; manager: string | null; phone: string; language: Language; property_name: string; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select ce.org_id, ce.tenancy_id, ce.amount_paise, ce.received_on::text as received_on, u.name as manager,
               t.phone, t.language, p.name as property_name, p.wa_phone_number_id
        from cash_entries ce join users u on u.id = ce.recorded_by
        join tenancies tc on tc.id = ce.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where ce.id = ${cashEntryId}`,
  );
  if (!c) return;
  await sendMessage(
    deps,
    { phone: c.phone, orgId: c.org_id, tenancyId: c.tenancy_id, phoneNumberId: c.wa_phone_number_id },
    {
      kind: "template",
      name: "rf_cash_confirm",
      language: c.language,
      variables: [c.property_name, c.manager ?? "your manager", formatINR(toPaise(c.amount_paise)), formatDate(c.received_on)],
      buttonIds: [`cash:${cashEntryId}:yes`, `cash:${cashEntryId}:no`],
    },
  );
}

/** The tenant's answer, from the bot. Returns false if it was already answered or isn't theirs. */
export async function respondToCash(deps: AppDeps, phone: string, cashEntryId: string, correct: boolean): Promise<"done" | "already" | "not_found"> {
  let receiptId: string | null = null;
  let disputed: { orgId: string; text: string; property: string } | null = null;
  const result = await deps.db.transaction(async (tx) => {
    const c = await one<{ org_id: string; tenancy_id: string; amount_paise: unknown; tenant_confirmed_at: Date | null; disputed_at: Date | null; tenant_name: string; property_name: string; room: string }>(
      tx,
      sql`select ce.org_id, ce.tenancy_id, ce.amount_paise, ce.tenant_confirmed_at, ce.disputed_at, t.name as tenant_name, p.name as property_name, r.number || b.label as room
          from cash_entries ce join tenancies tc on tc.id = ce.tenancy_id join tenants t on t.id = tc.tenant_id
          join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
          where ce.id = ${cashEntryId} and t.phone = ${phone} for update of ce`,
    );
    if (!c) return "not_found" as const;
    if (c.tenant_confirmed_at || c.disputed_at) return "already" as const;
    if (!correct) {
      await tx.update(cashEntries).set({ disputedAt: deps.now() }).where(eq(cashEntries.id, cashEntryId));
      disputed = { orgId: c.org_id, property: c.property_name, text: `${c.tenant_name} (${c.room}) says the cash entry of ${formatINR(toPaise(c.amount_paise))} is NOT correct. Please check.` };
      return "done" as const;
    }
    const amount = toPaise(c.amount_paise);
    await tx.update(cashEntries).set({ tenantConfirmedAt: deps.now() }).where(eq(cashEntries.id, cashEntryId));
    await tx.insert(ledgerEntries).values({ orgId: c.org_id, tenancyId: c.tenancy_id, type: "payment", amountPaise: -amount, refType: "cash_entry", refId: cashEntryId });
    await refreshBillStatus(tx, c.tenancy_id);
    receiptId = await createReceipt(tx, { orgId: c.org_id, tenancyId: c.tenancy_id, amountPaise: amount, cashEntryId });
    return "done" as const;
  });
  if (receiptId) await deps.jobs.send("receipt.send", { receiptId });
  const d = disputed as { orgId: string; text: string; property: string } | null;
  if (d) await alertOwners(deps, d.orgId, d.property, d.text);
  return result;
}

/** Owner marks cash as handed over by the manager (clears it from "cash in hand"). */
export async function markCashHandedOver(deps: AppDeps, actor: Actor, cashEntryIds: string[]): Promise<void> {
  requireOwner(actor);
  if (cashEntryIds.length === 0) return;
  await deps.db
    .update(cashEntries)
    .set({ handedOverAt: deps.now() })
    .where(and(eq(cashEntries.orgId, actor.orgId), inArray(cashEntries.id, cashEntryIds), isNull(cashEntries.handedOverAt)));
}

/** Resend the WhatsApp confirmation for a pending entry. */
export async function resendCashConfirmation(deps: AppDeps, actor: Actor, cashEntryId: string): Promise<void> {
  const c = await one<{ property_id: string; tenant_confirmed_at: Date | null; disputed_at: Date | null }>(
    deps.db,
    sql`select r.property_id, ce.tenant_confirmed_at, ce.disputed_at from cash_entries ce join tenancies tc on tc.id = ce.tenancy_id
        join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id where ce.id = ${cashEntryId} and ce.org_id = ${actor.orgId}`,
  );
  if (!c) throw new ForbiddenError();
  requireProperty(actor, c.property_id, "record_cash");
  if (c.tenant_confirmed_at || c.disputed_at) throw new UserError("The tenant has already answered.");
  await deps.jobs.send("cash.confirm.send", { cashEntryId });
}
