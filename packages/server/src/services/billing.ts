/**
 * M3: monthly billing cycles.
 *
 * Cycle P (e.g. 2026-11) bills, for every current tenancy of the property:
 *   - rent not yet billed, up to the end of P (advance rent; mid-month joiners
 *     also get their unbilled days from the month they joined),
 *   - electricity used in P−1 (meter reading at end of P−2 → end of P−1, plus any
 *     check-out readings in between), split by tenant-days,
 *   - fixed charges, previous dues, adjustments recorded since the last bill, late fee,
 *   - lines the owner/manager added by hand while reviewing the draft.
 * Due date = due_day of P. Approval locks the cycle and writes the ledger.
 */
import {
  addDays,
  addMonths,
  assignPayableAmounts,
  billStatus,
  composeBill,
  dueDateFor,
  formatDate,
  formatINR,
  formatPeriod,
  meterAnomalies,
  newCharges,
  parseLateFeeRule,
  periodEnd,
  periodStart,
  rentSegments,
  splitMeterUsage,
  todayInIndia,
  type Anomaly,
  type DraftLine,
  type MeterSegmentResult,
  type Period,
} from "@rentflow/core";
import { billingCycles, billLines, bills, ledgerEntries, meterReadings, type Queryable, type Tx } from "@rentflow/db";
import { eq, sql } from "drizzle-orm";
import { assertPropertyInOrg, ForbiddenError, requireOwner, requireProperty, UserError, type Actor } from "../actor";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";

// ─── Meter readings ─────────────────────────────────────────────────────────

export async function recordMeterReading(
  deps: AppDeps,
  actor: Actor,
  input: { meterId: string; period: Period; reading: number; photo: { bytes: Buffer; contentType: string } | null },
): Promise<void> {
  const meter = await one<{ property_id: string; name: string }>(
    deps.db,
    sql`select property_id, name from meters where id = ${input.meterId} and org_id = ${actor.orgId}`,
  );
  if (!meter) throw new ForbiddenError();
  requireProperty(actor, meter.property_id, "enter_readings");
  if (!Number.isSafeInteger(input.reading) || input.reading < 0) throw new UserError("Enter the reading as a whole number of units.");
  if (!input.photo) throw new UserError("Take a photo of the meter — it's required.");

  // Reading P is used by cycle P+1 (as the end of the month) and P+2 (as the start).
  const locked = await one<{ period: string }>(
    deps.db,
    sql`select period from billing_cycles where property_id = ${meter.property_id} and kind = 'monthly' and status <> 'draft'
        and period in (${addMonths(input.period, 1)}, ${addMonths(input.period, 2)}) limit 1`,
  );
  if (locked) throw new UserError(`This reading was used by the approved ${formatPeriod(locked.period)} bills and can't be changed. Add an adjustment instead.`);

  const photoRef = `${actor.orgId}/meters/${input.meterId}/${input.period}-${Date.now()}.${input.photo.contentType.includes("png") ? "png" : "jpg"}`;
  await deps.files.put(photoRef, input.photo.bytes, input.photo.contentType);
  await deps.db
    .insert(meterReadings)
    .values({
      orgId: actor.orgId,
      meterId: input.meterId,
      kind: "monthly",
      period: input.period,
      readingDate: periodEnd(input.period),
      reading: input.reading,
      photoRef,
      readBy: actor.userId,
      readAt: deps.now(),
    })
    .onConflictDoUpdate({
      target: [meterReadings.meterId, meterReadings.period],
      targetWhere: sql`kind = 'monthly'`,
      set: { reading: input.reading, photoRef, readBy: actor.userId, readAt: deps.now() },
    });

  // Keep an open draft in sync with the new reading.
  const draft = await one<{ period: string }>(
    deps.db,
    sql`select period from billing_cycles where property_id = ${meter.property_id} and kind = 'monthly' and status = 'draft'
        and period in (${addMonths(input.period, 1)}, ${addMonths(input.period, 2)}) limit 1`,
  );
  if (draft) await buildMonthlyDraft(deps, { orgId: actor.orgId, userId: actor.userId }, meter.property_id, draft.period);
}

// ─── Drafting ───────────────────────────────────────────────────────────────

interface BillTenancy {
  id: string;
  rent_paise: unknown;
  check_in: string;
  check_out: string | null;
  room_id: string;
  room_number: string;
  bed_label: string;
  meter_id: string | null;
}

/** Who is building the draft: a person, or the scheduler (userId null). */
export interface Builder {
  orgId: string;
  userId: string | null;
}

/** Creates the monthly draft for a property, or rebuilds it (keeping hand-added lines). */
export async function createOrRebuildDraft(deps: AppDeps, actor: Actor, propertyId: string, period: Period): Promise<string> {
  requireProperty(actor, propertyId);
  await assertPropertyInOrg(deps.db, actor, propertyId);
  return buildMonthlyDraft(deps, { orgId: actor.orgId, userId: actor.userId }, propertyId, period);
}

export async function buildMonthlyDraft(deps: AppDeps, builder: Builder, propertyId: string, period: Period): Promise<string> {
  return deps.db.transaction(async (tx) => {
    const property = await one<{ due_day: number; electricity_rate_paise: unknown; late_fee_rule: unknown }>(
      tx,
      sql`select due_day, electricity_rate_paise, late_fee_rule from properties where id = ${propertyId} and org_id = ${builder.orgId}`,
    );
    if (!property) throw new ForbiddenError();

    let cycle = await one<{ id: string; status: string }>(
      tx,
      sql`select id, status from billing_cycles where property_id = ${propertyId} and period = ${period} and kind = 'monthly' for update`,
    );
    if (cycle && cycle.status !== "draft") throw new UserError(`${formatPeriod(period)} is already approved and locked.`);
    if (!cycle) {
      const [created] = await tx
        .insert(billingCycles)
        .values({ orgId: builder.orgId, propertyId, period, kind: "monthly", dueDate: dueDateFor(period, property.due_day) })
        .returning({ id: billingCycles.id });
      if (!created) throw new Error("insert failed");
      cycle = { id: created.id, status: "draft" };
    }

    const end = periodEnd(period);
    const list = await many<BillTenancy>(
      tx,
      sql`select tc.id, tc.rent_paise, tc.check_in::text as check_in, tc.check_out::text as check_out,
                 r.id as room_id, r.number as room_number, b.label as bed_label, r.meter_id
          from tenancies tc join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
          where r.property_id = ${propertyId} and tc.status in ('active', 'notice') and tc.check_in <= ${end}
            and not exists (select 1 from billing_cycles fc where fc.kind = 'final' and fc.tenancy_id = tc.id)
          order by r.number, b.label`,
    );

    const ratePaise = property.electricity_rate_paise === null ? null : toPaise(property.electricity_rate_paise);
    const { segmentsByMeter, anomalies } = await electricityForPeriod(tx, propertyId, addMonths(period, -1), ratePaise);
    const lateFeeRule = parseLateFeeRule(property.late_fee_rule);
    const today = todayInIndia(deps.now());

    const manual = await many<{ tenancy_id: string; kind: "service" | "adjustment"; description: string; amount_paise: unknown }>(
      tx,
      sql`select b.tenancy_id, l.kind, l.description, l.amount_paise from bill_lines l join bills b on b.id = l.bill_id
          where b.cycle_id = ${cycle.id} and l.manual order by l.sort`,
    );
    await tx.delete(bills).where(eq(bills.cycleId, cycle.id));

    const fixed = await fixedCharges(tx, propertyId);
    for (const t of list) {
      const parts = await tenancyParts(tx, t, period, today, lateFeeRule);
      const lines = composeBill({
        tenancyId: t.id,
        rentSegments: parts.rentSegments,
        fixedCharges: parts.hasFixedForPeriod(period) ? [] : fixed,
        electricity: ratePaise !== null && t.meter_id && segmentsByMeter.has(t.meter_id)
          ? { meterId: t.meter_id, ratePaise, segments: segmentsByMeter.get(t.meter_id) ?? [] }
          : null,
        previousDuePaise: parts.previousDue,
        ledgerAdjustments: parts.adjustments,
        lateFee: parts.lateFee,
        extraLines: manual.filter((m) => m.tenancy_id === t.id).map((m) => ({ kind: m.kind, description: m.description, amountPaise: toPaise(m.amount_paise) })),
      });
      if (lines.length === 0) continue;
      await insertBill(tx, builder.orgId, cycle.id, t.id, lines);
    }
    await tx.update(billingCycles).set({ anomalies }).where(eq(billingCycles.id, cycle.id));
    return cycle.id;
  });
}

async function fixedCharges(tx: Queryable, propertyId: string) {
  const rows = await many<{ id: string; name: string; amount: unknown }>(
    tx,
    sql`select id, name, (config->>'amount_paise')::bigint as amount from services
        where property_id = ${propertyId} and type = 'fixed' and active order by menu_order, name`,
  );
  return rows.filter((r) => toPaise(r.amount) > 0).map((r) => ({ serviceId: r.id, name: r.name, amountPaise: toPaise(r.amount) }));
}

/** Rent, dues, adjustments and late fee for one tenancy. */
async function tenancyParts(tx: Queryable, t: BillTenancy, period: Period, today: string, lateFeeRule: ReturnType<typeof parseLateFeeRule>) {
  const billed = await one<{ until: string | null }>(
    tx,
    sql`select max(l.period_end)::text as until from bill_lines l join bills b on b.id = l.bill_id
        join billing_cycles c on c.id = b.cycle_id
        where b.tenancy_id = ${t.id} and l.kind = 'rent' and c.status <> 'draft'`,
  );
  // Tenants who were here before RentFlow: start billing from this period, not from their check-in.
  let billedUntil = billed?.until ?? null;
  if (!billedUntil && t.check_in < periodStart(addMonths(period, -1))) billedUntil = addDays(periodStart(period), -1);

  const segments = rentSegments({
    rentPaise: toPaise(t.rent_paise),
    checkIn: t.check_in,
    checkOut: t.check_out,
    billedUntil,
    billThrough: periodEnd(period),
  });

  const balance = await one<{ dues: unknown }>(
    tx,
    sql`select coalesce(sum(amount_paise), 0) as dues from ledger_entries
        where tenancy_id = ${t.id} and type in ('charge', 'payment', 'reversal', 'adjustment')`,
  );
  const adjustments = await many<{ id: string; note: string | null; amount_paise: unknown }>(
    tx,
    sql`select e.id, e.note, e.amount_paise from ledger_entries e
        where e.tenancy_id = ${t.id} and e.type = 'adjustment' and e.ref_type = 'post_approval'
          and not exists (
            select 1 from bill_lines l join bills b on b.id = l.bill_id join billing_cycles c on c.id = b.cycle_id
            where l.source_id = e.id and c.status <> 'draft')
        order by e.created_at`,
  );
  const adjustmentTotal = adjustments.reduce((s, a) => s + toPaise(a.amount_paise), 0);

  let lateFee: { amountPaise: number; description: string } | null = null;
  if (lateFeeRule) {
    const prev = await one<{ status: string; due_date: string; period: string }>(
      tx,
      sql`select b.status, c.due_date::text as due_date, c.period from bills b join billing_cycles c on c.id = b.cycle_id
          where b.tenancy_id = ${t.id} and c.status <> 'draft' and c.period < ${period}
          order by c.period desc, c.approved_at desc limit 1`,
    );
    if (prev && prev.status !== "paid" && today > addDays(prev.due_date, lateFeeRule.grace_days)) {
      lateFee = { amountPaise: lateFeeRule.amount_paise, description: `Late fee: ${formatPeriod(prev.period)} not paid by ${formatDate(addDays(prev.due_date, lateFeeRule.grace_days))}` };
    }
  }

  const fixedBilled = await many<{ period: string }>(
    tx,
    sql`select distinct c.period from bill_lines l join bills b on b.id = l.bill_id join billing_cycles c on c.id = b.cycle_id
        where b.tenancy_id = ${t.id} and l.kind = 'fixed' and c.status <> 'draft'`,
  );

  return {
    rentSegments: segments,
    previousDue: toPaise(balance?.dues) - adjustmentTotal,
    adjustments: adjustments.map((a) => ({ entryId: a.id, description: a.note ?? "Adjustment", amountPaise: toPaise(a.amount_paise) })),
    lateFee,
    hasFixedForPeriod: (p: Period) => fixedBilled.some((f) => f.period === p),
  };
}

/** Electricity used in `usagePeriod` for every room meter of the property, plus anomaly flags. */
export async function electricityForPeriod(tx: Queryable, propertyId: string, usagePeriod: Period, ratePaise: number | null) {
  const startReadingDate = periodEnd(addMonths(usagePeriod, -1));
  const endReadingDate = periodEnd(usagePeriod);
  const meterRows = await many<{ meter_id: string; room_id: string; room_number: string }>(
    tx,
    sql`select r.meter_id, r.id as room_id, r.number as room_number from rooms r
        where r.property_id = ${propertyId} and r.meter_id is not null order by r.number`,
  );
  const segmentsByMeter = new Map<string, MeterSegmentResult[]>();
  const anomalies: Anomaly[] = [];
  if (ratePaise === null) return { segmentsByMeter, anomalies };

  for (const m of meterRows) {
    const readings = await many<{ reading_date: string; reading: number; kind: string }>(
      tx,
      sql`select reading_date::text as reading_date, reading, kind from meter_readings
          where meter_id = ${m.meter_id} and reading_date between ${startReadingDate} and ${endReadingDate}
          order by reading_date, kind`,
    );
    const hasStart = readings.some((r) => r.kind === "monthly" && r.reading_date === startReadingDate);
    const hasEnd = readings.some((r) => r.kind === "monthly" && r.reading_date === endReadingDate);
    const occupants = await many<{ tenancy_id: string; check_in: string; check_out: string | null }>(
      tx,
      sql`select tc.id as tenancy_id, tc.check_in::text as check_in, tc.check_out::text as check_out
          from tenancies tc join beds b on b.id = tc.bed_id
          where b.room_id = ${m.room_id} and tc.check_in <= ${endReadingDate}
            and (tc.check_out is null or tc.check_out > ${startReadingDate})`,
    );
    if (!hasStart || !hasEnd) {
      // Only nag about rooms someone lived in.
      if (occupants.length > 0) {
        anomalies.push(...meterAnomalies({ meterId: m.meter_id, roomLabel: m.room_number, segments: null, history: [] }).map((a) => ({
          ...a,
          message: `Room ${m.room_number}: reading for ${formatDate(hasStart ? endReadingDate : startReadingDate)} is missing`,
        })));
      }
      continue;
    }
    // Final (check-out) readings on the same day as a monthly one are redundant.
    const points = readings
      .filter((r, i, all) => !(r.kind === "final" && all.some((o) => o.kind === "monthly" && o.reading_date === r.reading_date)))
      .map((r) => ({ date: r.reading_date, value: r.reading }));
    const segments = splitMeterUsage(points, ratePaise, occupants.map((o) => ({ tenancyId: o.tenancy_id, checkIn: o.check_in, checkOut: o.check_out })));
    segmentsByMeter.set(m.meter_id, segments);

    const history = await many<{ reading: number }>(
      tx,
      sql`select reading from meter_readings where meter_id = ${m.meter_id} and kind = 'monthly'
          and period between ${addMonths(usagePeriod, -4)} and ${addMonths(usagePeriod, -1)} order by period`,
    );
    const usage = history.slice(1).map((h, i) => h.reading - (history[i]?.reading ?? h.reading));
    anomalies.push(...meterAnomalies({ meterId: m.meter_id, roomLabel: m.room_number, segments, history: usage }));
  }
  return { segmentsByMeter, anomalies };
}

/** Lines typed in by a person (as opposed to calculated ones). */
function isManual(l: DraftLine): boolean {
  return l.sourceId === null && !l.carried && (l.kind === "service" || l.kind === "adjustment");
}

async function insertBill(tx: Tx, orgId: string, cycleId: string, tenancyId: string, lines: DraftLine[]) {
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  const [bill] = await tx.insert(bills).values({ orgId, tenancyId, cycleId, totalPaise: total }).returning({ id: bills.id });
  if (!bill) throw new Error("insert failed");
  await tx.insert(billLines).values(
    lines.map((l, i) => ({
      orgId,
      billId: bill.id,
      kind: l.kind,
      sourceId: l.sourceId,
      description: l.description,
      amountPaise: l.amountPaise,
      periodStart: l.periodStart,
      periodEnd: l.periodEnd,
      carried: l.carried,
      manual: isManual(l),
      sort: i,
    })),
  );
  return bill.id;
}

// ─── Reviewing a draft ──────────────────────────────────────────────────────

async function draftBill(db: Queryable, actor: Actor, billId: string) {
  const row = await one<{ cycle_id: string; status: string; property_id: string }>(
    db,
    sql`select b.cycle_id, c.status, c.property_id from bills b join billing_cycles c on c.id = b.cycle_id
        where b.id = ${billId} and b.org_id = ${actor.orgId}`,
  );
  if (!row) throw new ForbiddenError();
  if (row.status !== "draft") throw new UserError("This cycle is approved and locked. Add an adjustment for the next bill instead.");
  return row;
}

/** Variable charges and corrections, added while reviewing the draft (manager or owner). */
export async function addDraftLine(
  deps: AppDeps,
  actor: Actor,
  billId: string,
  input: { kind: "service" | "adjustment"; description: string; amountPaise: number },
): Promise<void> {
  const bill = await draftBill(deps.db, actor, billId);
  requireProperty(actor, bill.property_id);
  if (!input.description.trim()) throw new UserError("Describe the charge.");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise === 0) throw new UserError("Enter an amount.");
  if (input.amountPaise < 0 && actor.role !== "owner") throw new ForbiddenError("Only the owner can give discounts.");
  await deps.db.transaction(async (tx) => {
    const last = await one<{ sort: number }>(tx, sql`select coalesce(max(sort), 0) as sort from bill_lines where bill_id = ${billId}`);
    await tx.insert(billLines).values({
      orgId: actor.orgId,
      billId,
      kind: input.kind,
      description: input.description.trim(),
      amountPaise: input.amountPaise,
      manual: true,
      sort: (last?.sort ?? 0) + 1,
    });
    await recomputeTotal(tx, billId);
  });
}

export async function removeDraftLine(deps: AppDeps, actor: Actor, lineId: string): Promise<void> {
  const line = await one<{ bill_id: string; manual: boolean }>(deps.db, sql`select bill_id, manual from bill_lines where id = ${lineId} and org_id = ${actor.orgId}`);
  if (!line) throw new ForbiddenError();
  const bill = await draftBill(deps.db, actor, line.bill_id);
  requireProperty(actor, bill.property_id);
  if (!line.manual) throw new UserError("Calculated lines can't be removed. Add an adjustment line instead.");
  await deps.db.transaction(async (tx) => {
    await tx.delete(billLines).where(eq(billLines.id, lineId));
    await recomputeTotal(tx, line.bill_id);
  });
}

async function recomputeTotal(tx: Tx, billId: string) {
  await tx.execute(sql`update bills set total_paise = (select coalesce(sum(amount_paise), 0) from bill_lines where bill_id = ${billId}) where id = ${billId}`);
}

// ─── Approval ───────────────────────────────────────────────────────────────

/** Locks the cycle, gives every bill a unique payable amount, writes the charges to the ledger, then queues sending. */
export async function approveCycle(deps: AppDeps, actor: Actor, cycleId: string): Promise<void> {
  requireOwner(actor);
  await approveCycleAs(deps, { orgId: actor.orgId, userId: actor.userId }, cycleId);
}

/**
 * The approval itself. `userId` is null when the bill automation approves on
 * its own (the owner switched "approve before sending" off), so the cycle and
 * ledger show no person as the approver.
 */
export async function approveCycleAs(deps: AppDeps, by: Builder, cycleId: string): Promise<void> {
  const actor = by;
  await deps.db.transaction(async (tx) => {
    const cycle = await one<{ property_id: string; status: string; kind: string }>(
      tx,
      sql`select property_id, status, kind from billing_cycles where id = ${cycleId} and org_id = ${actor.orgId} for update`,
    );
    if (!cycle) throw new ForbiddenError();
    if (cycle.status !== "draft") throw new UserError("This cycle is already approved.");

    const cycleBills = await many<{ id: string; tenancy_id: string; total_paise: unknown }>(
      tx,
      sql`select b.id, b.tenancy_id, b.total_paise from bills b join tenancies tc on tc.id = b.tenancy_id
          join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id
          where b.cycle_id = ${cycleId} order by r.number, bd.label`,
    );
    if (cycleBills.length === 0) throw new UserError("There are no bills in this cycle.");
    const inCycle = new Set(cycleBills.map((b) => b.tenancy_id));

    // Amounts other tenants of this property are still expected to pay.
    const open = await openBills(tx, actor.orgId, cycle.property_id);
    const taken = open.filter((b) => !inCycle.has(b.tenancyId)).map((b) => b.payablePaise);
    const payables = assignPayableAmounts(cycleBills.map((b) => ({ key: b.id, totalPaise: toPaise(b.total_paise) })), taken);

    for (const b of cycleBills) {
      const lines = await many<{ amount_paise: unknown; carried: boolean }>(tx, sql`select amount_paise, carried from bill_lines where bill_id = ${b.id}`);
      const charge = newCharges(lines.map((l) => ({ amountPaise: toPaise(l.amount_paise), carried: l.carried })));
      if (charge !== 0) {
        await tx.insert(ledgerEntries).values({
          orgId: actor.orgId,
          tenancyId: b.tenancy_id,
          type: charge > 0 ? "charge" : "adjustment",
          amountPaise: charge,
          refType: "bill",
          refId: b.id,
          createdBy: actor.userId,
        });
      }
      const total = toPaise(b.total_paise);
      await tx.update(bills).set({ payablePaise: payables.get(b.id) ?? 0, status: total <= 0 ? "paid" : "sent" }).where(eq(bills.id, b.id));
    }
    // Database clock, like ledger_entries.created_at, so "paid since approval" compares like with like.
    await tx.update(billingCycles).set({ status: "approved", approvedBy: actor.userId, approvedAt: sql`now()` }).where(eq(billingCycles.id, cycleId));
  });
  await deps.jobs.send("bills.send", { cycleId });
}

/** The latest approved bill of each current tenancy that still has money to collect. */
export async function openBills(db: Queryable, orgId: string, propertyId?: string) {
  const rows = await many<{ bill_id: string; tenancy_id: string; payable_paise: unknown; total_paise: unknown; balance: unknown; status: string }>(
    db,
    sql`select * from (
          select distinct on (b.tenancy_id) b.id as bill_id, b.tenancy_id, b.payable_paise, b.total_paise, b.status,
                 (select coalesce(sum(e.amount_paise), 0) from ledger_entries e
                  where e.tenancy_id = b.tenancy_id and e.type in ('charge', 'payment', 'reversal', 'adjustment')) as balance
          from bills b join billing_cycles c on c.id = b.cycle_id
          where b.org_id = ${orgId} and c.status <> 'draft' ${propertyId ? sql`and c.property_id = ${propertyId}` : sql``}
          order by b.tenancy_id, c.approved_at desc
        ) latest where status in ('sent', 'partially_paid')`,
  );
  return rows.map((r) => ({
    billId: r.bill_id,
    tenancyId: r.tenancy_id,
    payablePaise: toPaise(r.payable_paise),
    totalPaise: toPaise(r.total_paise),
    outstandingPaise: Math.max(0, toPaise(r.balance)),
  }));
}

/** Re-evaluates the status of a tenancy's latest bill after money moved. */
export async function refreshBillStatus(tx: Queryable, tenancyId: string): Promise<void> {
  const latest = await one<{ id: string; payable_paise: unknown; approved_at: Date }>(
    tx,
    sql`select b.id, b.payable_paise, c.approved_at from bills b join billing_cycles c on c.id = b.cycle_id
        where b.tenancy_id = ${tenancyId} and c.status <> 'draft' order by c.approved_at desc limit 1`,
  );
  if (!latest) return;
  const sums = await one<{ balance: unknown; paid: unknown }>(
    tx,
    sql`select coalesce(sum(amount_paise) filter (where type in ('charge', 'payment', 'reversal', 'adjustment')), 0) as balance,
               coalesce(-sum(amount_paise) filter (where type = 'payment' and created_at >= ${latest.approved_at}), 0) as paid
        from ledger_entries where tenancy_id = ${tenancyId}`,
  );
  const status = billStatus({ payablePaise: toPaise(latest.payable_paise), paidSinceApprovalPaise: toPaise(sums?.paid), balancePaise: toPaise(sums?.balance) });
  await tx.execute(sql`update bills set status = ${status} where id = ${latest.id}`);
}

/** After approval, changes become adjustments shown on the next bill (CLAUDE.md §7.4). */
export async function addAdjustment(deps: AppDeps, actor: Actor, tenancyId: string, amountPaise: number, description: string): Promise<void> {
  requireOwner(actor);
  if (!Number.isSafeInteger(amountPaise) || amountPaise === 0) throw new UserError("Enter an amount (negative for a discount or refund).");
  if (!description.trim()) throw new UserError("Describe the adjustment.");
  await deps.db.transaction(async (tx) => {
    const t = await one<{ id: string }>(tx, sql`select id from tenancies where id = ${tenancyId} and org_id = ${actor.orgId}`);
    if (!t) throw new ForbiddenError();
    await tx.insert(ledgerEntries).values({
      orgId: actor.orgId,
      tenancyId,
      type: "adjustment",
      amountPaise,
      refType: "post_approval",
      note: description.trim(),
      createdBy: actor.userId,
    });
    await refreshBillStatus(tx, tenancyId);
  });
}

/** One-line summary for the bill template ({{6}}; WhatsApp variables can't contain newlines). */
export function shortBreakdown(lines: { kind: string; description: string; amountPaise: number }[]): string {
  const label = (l: { kind: string; description: string }) =>
    l.kind === "rent" ? "Rent" : l.kind === "metered" ? "Electricity" : l.kind === "previous_due" ? (l.description.startsWith("Previous") ? "Previous dues" : "Credit") : l.description;
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(label(l), (merged.get(label(l)) ?? 0) + l.amountPaise);
  return [...merged.entries()].map(([k, v]) => `${k} ${formatINR(v)}`).join(" · ").slice(0, 900);
}

