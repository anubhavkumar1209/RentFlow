/**
 * M7: tenant leaves. Notice → final bill (prorated rent, final meter reading,
 * damages) → owner approves → deposit settlement → tenant confirms refund on
 * WhatsApp → bed vacant, tenancy closed (CLAUDE.md §3 Stage 6).
 */
import {
  addDays,
  composeBill,
  formatINR,
  isISODate,
  periodOf,
  rentSegments,
  splitMeterUsage,
  type Period,
} from "@rentflow/core";
import type { Language } from "@rentflow/core";
import { beds, billingCycles, billLines, bills, ledgerEntries, meterReadings, tenancies, type Tx } from "@rentflow/db";
import { eq, sql } from "drizzle-orm";
import { ForbiddenError, requireOwner, requireProperty, UserError, type Actor } from "../actor";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { refreshBillStatus } from "./billing";
import { sendMessage } from "./notify";
import { alertOwners } from "./payments";

interface TenancyRow {
  id: string;
  org_id: string;
  status: string;
  bed_id: string;
  room_id: string;
  meter_id: string | null;
  property_id: string;
  rent_paise: unknown;
  check_in: string;
  check_out: string | null;
  electricity_rate_paise: unknown;
}

async function loadTenancy(db: Tx | AppDeps["db"], actor: Actor, tenancyId: string): Promise<TenancyRow> {
  const t = await one<TenancyRow>(
    db,
    sql`select tc.id, tc.org_id, tc.status, tc.bed_id, r.id as room_id, r.meter_id, r.property_id, tc.rent_paise,
               tc.check_in::text as check_in, tc.check_out::text as check_out, p.electricity_rate_paise
        from tenancies tc join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where tc.id = ${tenancyId} and tc.org_id = ${actor.orgId}`,
  );
  if (!t) throw new ForbiddenError();
  return t;
}

export async function giveNotice(deps: AppDeps, actor: Actor, tenancyId: string, input: { noticeDate: string; checkOut: string }): Promise<void> {
  const t = await loadTenancy(deps.db, actor, tenancyId);
  requireProperty(actor, t.property_id, "manage_tenants");
  if (t.status === "closed") throw new UserError("This stay is already closed.");
  if (!isISODate(input.noticeDate) || !isISODate(input.checkOut)) throw new UserError("Enter the notice and check-out dates.");
  if (input.checkOut < t.check_in) throw new UserError("Check-out can't be before check-in.");
  const final = await one<{ status: string }>(deps.db, sql`select status from billing_cycles where tenancy_id = ${tenancyId} and kind = 'final'`);
  if (final && final.status !== "draft") throw new UserError("The final bill is already approved; the check-out date can't change.");
  await deps.db.transaction(async (tx) => {
    await tx.update(tenancies).set({ status: "notice", noticeDate: input.noticeDate, checkOut: input.checkOut }).where(eq(tenancies.id, tenancyId));
    await tx.update(beds).set({ status: "notice" }).where(eq(beds.id, t.bed_id));
  });
}

export async function cancelNotice(deps: AppDeps, actor: Actor, tenancyId: string): Promise<void> {
  const t = await loadTenancy(deps.db, actor, tenancyId);
  requireProperty(actor, t.property_id, "manage_tenants");
  if (t.status !== "notice") throw new UserError("This tenant isn't on notice.");
  const final = await one<{ id: string; status: string }>(deps.db, sql`select id, status from billing_cycles where tenancy_id = ${tenancyId} and kind = 'final'`);
  if (final && final.status !== "draft") throw new UserError("The final bill is already approved.");
  await deps.db.transaction(async (tx) => {
    if (final) await tx.delete(billingCycles).where(eq(billingCycles.id, final.id));
    await tx.update(tenancies).set({ status: "active", noticeDate: null, checkOut: null }).where(eq(tenancies.id, tenancyId));
    await tx.update(beds).set({ status: "occupied" }).where(eq(beds.id, t.bed_id));
  });
}

/**
 * Drafts the final bill: rent up to the check-out day, this tenant's share of
 * electricity up to the final reading, previous dues and damages. The owner
 * reviews and approves it on the Billing screen like any other cycle.
 */
export async function draftFinalBill(
  deps: AppDeps,
  actor: Actor,
  tenancyId: string,
  input: { finalReading: number | null; photo: { bytes: Buffer; contentType: string } | null; damages: { description: string; amountPaise: number }[] },
): Promise<string> {
  const t = await loadTenancy(deps.db, actor, tenancyId);
  requireProperty(actor, t.property_id, "manage_tenants");
  if (t.status !== "notice" || !t.check_out) throw new UserError("Record the tenant's notice and check-out date first.");
  const checkOut = t.check_out;
  for (const d of input.damages) {
    if (!d.description.trim() || !Number.isSafeInteger(d.amountPaise) || d.amountPaise <= 0) throw new UserError("Each damage needs a description and an amount.");
  }
  if (input.finalReading !== null && (!Number.isSafeInteger(input.finalReading) || input.finalReading < 0)) throw new UserError("Enter the final reading in whole units.");

  let photoRef: string | null = null;
  if (input.photo && t.meter_id) {
    photoRef = `${actor.orgId}/meters/${t.meter_id}/final-${checkOut}-${Date.now()}.jpg`;
    await deps.files.put(photoRef, input.photo.bytes, input.photo.contentType);
  }

  return deps.db.transaction(async (tx) => {
    const existing = await one<{ id: string; status: string }>(tx, sql`select id, status from billing_cycles where tenancy_id = ${tenancyId} and kind = 'final' for update`);
    if (existing && existing.status !== "draft") throw new UserError("The final bill is already approved.");
    if (existing) await tx.delete(billingCycles).where(eq(billingCycles.id, existing.id));

    if (t.meter_id && input.finalReading !== null) {
      await tx.execute(sql`delete from meter_readings where meter_id = ${t.meter_id} and kind = 'final' and reading_date = ${checkOut}`);
      await tx.insert(meterReadings).values({ orgId: actor.orgId, meterId: t.meter_id, kind: "final", readingDate: checkOut, reading: input.finalReading, photoRef, readBy: actor.userId, readAt: deps.now() });
    }

    const billed = await one<{ until: string | null }>(
      tx,
      sql`select max(l.period_end)::text as until from bill_lines l join bills b on b.id = l.bill_id join billing_cycles c on c.id = b.cycle_id
          where b.tenancy_id = ${tenancyId} and l.kind = 'rent' and c.status <> 'draft'`,
    );
    const segments = rentSegments({ rentPaise: toPaise(t.rent_paise), checkIn: t.check_in, checkOut, billedUntil: billed?.until ?? null, billThrough: checkOut });

    let electricity = null;
    const rate = t.electricity_rate_paise === null ? null : toPaise(t.electricity_rate_paise);
    if (t.meter_id && rate !== null && input.finalReading !== null) {
      // Electricity is billed through the last monthly reading used by an approved bill for this meter.
      const through = await one<{ until: string | null }>(
        tx,
        sql`select max(l.period_end)::text as until from bill_lines l join bills b on b.id = l.bill_id join billing_cycles c on c.id = b.cycle_id
            where l.kind = 'metered' and l.source_id = ${t.meter_id} and c.status <> 'draft'`,
      );
      const startDate = through?.until ?? addDays(t.check_in, -1);
      const readings = await many<{ reading_date: string; reading: number }>(
        tx,
        sql`select reading_date::text as reading_date, reading from meter_readings
            where meter_id = ${t.meter_id} and reading_date between ${startDate} and ${checkOut} order by reading_date, kind`,
      );
      const occupants = await many<{ tenancy_id: string; check_in: string; check_out: string | null }>(
        tx,
        sql`select tc.id as tenancy_id, tc.check_in::text as check_in, tc.check_out::text as check_out from tenancies tc join beds b on b.id = tc.bed_id
            where b.room_id = ${t.room_id} and tc.check_in <= ${checkOut} and (tc.check_out is null or tc.check_out > ${startDate})`,
      );
      if (readings.length >= 2) {
        electricity = {
          meterId: t.meter_id,
          ratePaise: rate,
          segments: splitMeterUsage(
            readings.map((r) => ({ date: r.reading_date, value: r.reading })),
            rate,
            occupants.map((o) => ({ tenancyId: o.tenancy_id, checkIn: o.check_in, checkOut: o.tenancy_id === tenancyId ? checkOut : o.check_out })),
          ),
        };
      }
    }

    const period: Period = periodOf(checkOut);
    const fixedBilled = await one<{ n: number }>(
      tx,
      sql`select count(*)::int as n from bill_lines l join bills b on b.id = l.bill_id join billing_cycles c on c.id = b.cycle_id
          where b.tenancy_id = ${tenancyId} and l.kind = 'fixed' and c.status <> 'draft' and c.period = ${period}`,
    );
    const fixed = (fixedBilled?.n ?? 0) > 0
      ? []
      : (await many<{ id: string; name: string; amount: unknown }>(
          tx,
          sql`select id, name, (config->>'amount_paise')::bigint as amount from services where property_id = ${t.property_id} and type = 'fixed' and active`,
        )).map((s) => ({ serviceId: s.id, name: s.name, amountPaise: toPaise(s.amount) }));

    const balance = await one<{ dues: unknown }>(tx, sql`select coalesce(sum(amount_paise), 0) as dues from ledger_entries where tenancy_id = ${tenancyId} and type in ('charge', 'payment', 'reversal', 'adjustment')`);
    const lines = composeBill({
      tenancyId,
      rentSegments: segments,
      fixedCharges: fixed,
      electricity,
      previousDuePaise: toPaise(balance?.dues),
      ledgerAdjustments: [],
      lateFee: null,
      extraLines: input.damages.map((d) => ({ kind: "adjustment" as const, description: `Damages: ${d.description.trim()}`, amountPaise: d.amountPaise })),
    });

    const [cycle] = await tx
      .insert(billingCycles)
      .values({ orgId: actor.orgId, propertyId: t.property_id, kind: "final", period, tenancyId, dueDate: checkOut })
      .returning({ id: billingCycles.id });
    if (!cycle) throw new Error("insert failed");
    const total = lines.reduce((s, l) => s + l.amountPaise, 0);
    const [bill] = await tx.insert(bills).values({ orgId: actor.orgId, tenancyId, cycleId: cycle.id, totalPaise: total }).returning({ id: bills.id });
    if (!bill) throw new Error("insert failed");
    if (lines.length > 0) {
      await tx.insert(billLines).values(
        lines.map((l, i) => ({
          orgId: actor.orgId,
          billId: bill.id,
          kind: l.kind,
          sourceId: l.sourceId,
          description: l.description,
          amountPaise: l.amountPaise,
          periodStart: l.periodStart,
          periodEnd: l.periodEnd,
          carried: l.carried,
          manual: l.sourceId === null && !l.carried && (l.kind === "service" || l.kind === "adjustment"),
          sort: i,
        })),
      );
    }
    return cycle.id;
  });
}

/**
 * After the final bill is approved: use the deposit against what's owed and
 * refund the rest. Ledger: payment (−applied) + deposit_out (−applied − refund).
 */
export async function settleDeposit(deps: AppDeps, actor: Actor, tenancyId: string): Promise<{ depositPaise: number; appliedPaise: number; refundPaise: number; stillOwedPaise: number }> {
  requireOwner(actor);
  const result = await deps.db.transaction(async (tx) => {
    const t = await loadTenancy(tx, actor, tenancyId);
    if (t.status === "closed") throw new UserError("This stay is already closed.");
    const final = await one<{ status: string }>(tx, sql`select status from billing_cycles where tenancy_id = ${tenancyId} and kind = 'final'`);
    if (!final || final.status === "draft") throw new UserError("Approve the final bill first.");
    const existing = await one<{ settlement: unknown }>(tx, sql`select settlement from tenancies where id = ${tenancyId} for update`);
    if (existing?.settlement) throw new UserError("The deposit is already settled.");

    const sums = await one<{ dues: unknown; deposit: unknown }>(
      tx,
      sql`select coalesce(sum(amount_paise) filter (where type in ('charge', 'payment', 'reversal', 'adjustment')), 0) as dues,
                 coalesce(sum(amount_paise) filter (where type in ('deposit_in', 'deposit_out')), 0) as deposit
          from ledger_entries where tenancy_id = ${tenancyId}`,
    );
    const dues = toPaise(sums?.dues);
    const deposit = Math.max(0, toPaise(sums?.deposit));
    const applied = Math.min(deposit, Math.max(0, dues));
    const refund = deposit - applied;
    const stillOwed = Math.max(0, dues - applied);

    if (applied > 0) {
      await tx.insert(ledgerEntries).values({ orgId: actor.orgId, tenancyId, type: "payment", amountPaise: -applied, refType: "deposit", note: "Dues paid from deposit", createdBy: actor.userId });
      await tx.insert(ledgerEntries).values({ orgId: actor.orgId, tenancyId, type: "deposit_out", amountPaise: -applied, refType: "deposit", note: "Deposit used for dues", createdBy: actor.userId });
    }
    if (refund > 0) {
      await tx.insert(ledgerEntries).values({ orgId: actor.orgId, tenancyId, type: "deposit_out", amountPaise: -refund, refType: "deposit_refund", note: "Deposit refunded", createdBy: actor.userId });
    }
    await tx
      .update(tenancies)
      .set({ settlement: { deposit_paise: deposit, applied_paise: applied, refund_paise: refund, still_owed_paise: stillOwed, settled_at: deps.now().toISOString(), confirmed_at: null, disputed_at: null } })
      .where(eq(tenancies.id, tenancyId));
    await refreshBillStatus(tx, tenancyId);
    return { depositPaise: deposit, appliedPaise: applied, refundPaise: refund, stillOwedPaise: stillOwed };
  });
  if (result.refundPaise > 0) await deps.jobs.send("refund.confirm.send", { tenancyId });
  else if (result.stillOwedPaise === 0) await closeTenancy(deps, actor, tenancyId);
  return result;
}

export async function sendRefundConfirmation(deps: AppDeps, tenancyId: string): Promise<void> {
  const t = await one<{ org_id: string; settlement: { deposit_paise: number; applied_paise: number; refund_paise: number } | null; phone: string; language: Language; property_name: string; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select tc.org_id, tc.settlement, t.phone, t.language, p.name as property_name, p.wa_phone_number_id
        from tenancies tc join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where tc.id = ${tenancyId}`,
  );
  if (!t?.settlement) return;
  await sendMessage(
    deps,
    { phone: t.phone, orgId: t.org_id, tenancyId, phoneNumberId: t.wa_phone_number_id },
    {
      kind: "template",
      name: "rf_refund_confirm",
      language: t.language,
      variables: [t.property_name, formatINR(t.settlement.deposit_paise), formatINR(t.settlement.applied_paise), formatINR(t.settlement.refund_paise)],
      buttonIds: [`refund:${tenancyId}:yes`, `refund:${tenancyId}:no`],
    },
  );
}

export async function respondToRefund(deps: AppDeps, phone: string, tenancyId: string, received: boolean): Promise<"done" | "already" | "not_found"> {
  const t = await one<{ org_id: string; settlement: Record<string, unknown> | null; status: string; tenant_name: string; property_name: string; bed_id: string }>(
    deps.db,
    sql`select tc.org_id, tc.settlement, tc.status, t.name as tenant_name, p.name as property_name, tc.bed_id
        from tenancies tc join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where tc.id = ${tenancyId} and t.phone = ${phone}`,
  );
  if (!t?.settlement) return "not_found";
  if (t.settlement.confirmed_at || t.settlement.disputed_at) return "already";
  if (received) {
    await deps.db.transaction(async (tx) => {
      await tx.update(tenancies).set({ settlement: { ...t.settlement, confirmed_at: deps.now().toISOString() } }).where(eq(tenancies.id, tenancyId));
      await closeInTx(tx, tenancyId, t.bed_id);
    });
  } else {
    await deps.db.update(tenancies).set({ settlement: { ...t.settlement, disputed_at: deps.now().toISOString() } }).where(eq(tenancies.id, tenancyId));
    await alertOwners(deps, t.org_id, t.property_name, `${t.tenant_name} says they did NOT receive the deposit refund. Please check.`);
  }
  return "done";
}

/** Owner closes a stay by hand (e.g. the tenant isn't on WhatsApp any more). */
export async function closeTenancy(deps: AppDeps, actor: Actor, tenancyId: string): Promise<void> {
  requireOwner(actor);
  const t = await loadTenancy(deps.db, actor, tenancyId);
  if (t.status === "closed") return;
  await deps.db.transaction((tx) => closeInTx(tx, tenancyId, t.bed_id));
}

async function closeInTx(tx: Tx, tenancyId: string, bedId: string) {
  await tx.update(tenancies).set({ status: "closed" }).where(eq(tenancies.id, tenancyId));
  await tx.update(beds).set({ status: "vacant" }).where(eq(beds.id, bedId));
  // TODO(phase-2): schedule deletion of the ID document a configurable time after check-out (DPDP, §13).
}
