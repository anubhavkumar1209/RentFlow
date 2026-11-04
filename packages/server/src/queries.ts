/**
 * Read models for the web app. Call these inside asUser(...) so RLS decides
 * what the person may see (managers only get their properties); queries also
 * filter by org as a second line of defence.
 */
import { addMonths, periodEnd, periodStart, type Period } from "@rentflow/core";
import type { Language } from "@rentflow/core";
import type { Queryable } from "@rentflow/db";
import { sql } from "drizzle-orm";
import { many, one, toDate, toDateOrNull, toPaise } from "./sql";

const DUES = sql.raw(`type in ('charge', 'payment', 'reversal', 'adjustment')`);

export async function listProperties(tx: Queryable, orgId: string) {
  const rows = await many<{ id: string; name: string; address: string | null; due_day: number; upi_vpa: string | null; beds: number; occupied: number; rooms: number }>(
    tx,
    sql`select p.id, p.name, p.address, p.due_day, p.upi_vpa,
               (select count(*)::int from beds b join rooms r on r.id = b.room_id where r.property_id = p.id) as beds,
               (select count(*)::int from beds b join rooms r on r.id = b.room_id where r.property_id = p.id and b.status in ('occupied', 'notice')) as occupied,
               (select count(*)::int from rooms r where r.property_id = p.id) as rooms
        from properties p where p.org_id = ${orgId} order by p.created_at`,
  );
  return rows;
}

export async function propertyDetail(tx: Queryable, orgId: string, propertyId: string) {
  const property = await one<{
    id: string; name: string; address: string | null; due_day: number; upi_vpa: string | null; payee_name: string | null;
    electricity_rate_paise: unknown; late_fee_rule: { amount_paise: number; grace_days: number } | null; upi_phone: string | null;
  }>(tx, sql`select id, name, address, due_day, upi_vpa, payee_name, electricity_rate_paise, late_fee_rule, upi_phone from properties where id = ${propertyId} and org_id = ${orgId}`);
  if (!property) return null;
  const charges = await many<{ id: string; name: string; amount: unknown; active: boolean }>(
    tx,
    sql`select id, name, (config->>'amount_paise')::bigint as amount, active from services where property_id = ${propertyId} and type = 'fixed' order by menu_order, name`,
  );
  const bedRows = await many<{ room_id: string; floor_id: string; floor_name: string; floor_sort: number; room: string; sharing: number; meter_id: string | null; bed_id: string; label: string; status: string; default_rent_paise: unknown; tenancy_id: string | null; tenant_name: string | null }>(
    tx,
    sql`select r.id as room_id, f.id as floor_id, f.name as floor_name, f.sort as floor_sort, r.number as room, r.sharing, r.meter_id,
               b.id as bed_id, b.label, b.status, b.default_rent_paise, tc.id as tenancy_id, t.name as tenant_name
        from rooms r join floors f on f.id = r.floor_id join beds b on b.room_id = r.id
        left join tenancies tc on tc.bed_id = b.id and tc.status in ('active', 'notice')
        left join tenants t on t.id = tc.tenant_id
        where r.property_id = ${propertyId} order by f.sort, r.number, b.label`,
  );
  const rooms = new Map<string, { id: string; floorId: string; floorName: string; floorSort: number; number: string; sharing: number; meterId: string | null; beds: { id: string; label: string; status: string; rentPaise: number; tenancyId: string | null; tenantName: string | null }[] }>();
  for (const r of bedRows) {
    const room = rooms.get(r.room_id) ?? { id: r.room_id, floorId: r.floor_id, floorName: r.floor_name, floorSort: r.floor_sort, number: r.room, sharing: r.sharing, meterId: r.meter_id, beds: [] };
    room.beds.push({ id: r.bed_id, label: r.label, status: r.status, rentPaise: toPaise(r.default_rent_paise), tenancyId: r.tenancy_id, tenantName: r.tenant_name });
    rooms.set(r.room_id, room);
  }
  return {
    ...property,
    electricityRatePaise: property.electricity_rate_paise === null ? null : toPaise(property.electricity_rate_paise),
    charges: charges.map((c) => ({ id: c.id, name: c.name, amountPaise: toPaise(c.amount), active: c.active })),
    rooms: [...rooms.values()],
  };
}

export interface TenantRow {
  tenancyId: string;
  name: string;
  phone: string;
  propertyId: string;
  propertyName: string;
  room: string;
  bed: string;
  rentPaise: number;
  status: string;
  balancePaise: number;
  checkIn: string;
  checkOut: string | null;
  consented: boolean;
}

export async function listTenants(tx: Queryable, orgId: string, filter: { propertyId?: string; status?: "current" | "closed"; search?: string } = {}): Promise<TenantRow[]> {
  const search = filter.search?.trim() ? `%${filter.search.trim().toLowerCase()}%` : null;
  const rows = await many<{ tenancy_id: string; name: string; phone: string; property_id: string; property_name: string; room: string; bed: string; rent_paise: unknown; status: string; balance: unknown; check_in: string; check_out: string | null; consent_at: Date | null }>(
    tx,
    sql`select tc.id as tenancy_id, t.name, t.phone, p.id as property_id, p.name as property_name, r.number as room, b.label as bed, tc.rent_paise, tc.status,
               (select coalesce(sum(e.amount_paise), 0) from ledger_entries e where e.tenancy_id = tc.id and e.${DUES}) as balance,
               tc.check_in::text as check_in, tc.check_out::text as check_out, t.consent_at
        from tenancies tc join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where tc.org_id = ${orgId}
          ${filter.propertyId ? sql`and p.id = ${filter.propertyId}` : sql``}
          ${filter.status === "closed" ? sql`and tc.status = 'closed'` : sql`and tc.status in ('active', 'notice')`}
          ${search ? sql`and (lower(t.name) like ${search} or t.phone like ${search} or lower(r.number) like ${search})` : sql``}
        order by p.name, r.number, b.label`,
  );
  return rows.map((r) => ({
    tenancyId: r.tenancy_id,
    name: r.name,
    phone: r.phone,
    propertyId: r.property_id,
    propertyName: r.property_name,
    room: r.room,
    bed: r.bed,
    rentPaise: toPaise(r.rent_paise),
    status: r.status,
    balancePaise: toPaise(r.balance),
    checkIn: r.check_in,
    checkOut: r.check_out,
    consented: r.consent_at !== null,
  }));
}

export async function tenantDetail(tx: Queryable, orgId: string, tenancyId: string) {
  const t = await one<{
    tenancy_id: string; tenant_id: string; name: string; phone: string; guardian_phones: string[]; language: Language; consent_at: Date | null;
    property_id: string; property_name: string; room: string; bed: string; rent_paise: unknown; deposit_paise: unknown; check_in: string;
    notice_date: string | null; check_out: string | null; status: string; settlement: Record<string, unknown> | null; meter_id: string | null;
  }>(
    tx,
    sql`select tc.id as tenancy_id, t.id as tenant_id, t.name, t.phone, t.guardian_phones, t.language, t.consent_at, p.id as property_id, p.name as property_name,
               r.number as room, b.label as bed, tc.rent_paise, tc.deposit_paise, tc.check_in::text as check_in, tc.notice_date::text as notice_date,
               tc.check_out::text as check_out, tc.status, tc.settlement, r.meter_id
        from tenancies tc join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where tc.id = ${tenancyId} and tc.org_id = ${orgId}`,
  );
  if (!t) return null;
  const ledger = await many<{ id: string; type: string; amount_paise: unknown; note: string | null; ref_type: string | null; created_at: Date }>(
    tx,
    sql`select id, type, amount_paise, note, ref_type, created_at from ledger_entries where tenancy_id = ${tenancyId} order by created_at, id`,
  );
  let running = 0;
  let deposit = 0;
  const entries = ledger.map((e) => {
    const amount = toPaise(e.amount_paise);
    const isDeposit = e.type === "deposit_in" || e.type === "deposit_out";
    if (isDeposit) deposit += amount;
    else running += amount;
    return { id: e.id, type: e.type, amountPaise: amount, note: e.note, refType: e.ref_type, createdAt: toDate(e.created_at), balancePaise: running, isDeposit };
  });
  const billRows = await many<{ id: string; period: string; kind: string; cycle_status: string; status: string; total_paise: unknown; payable_paise: unknown; due_date: string; cycle_id: string }>(
    tx,
    sql`select b.id, c.period, c.kind, c.status as cycle_status, b.status, b.total_paise, b.payable_paise, c.due_date::text as due_date, c.id as cycle_id
        from bills b join billing_cycles c on c.id = b.cycle_id where b.tenancy_id = ${tenancyId} order by c.period desc, c.created_at desc`,
  );
  const receiptRows = await many<{ id: string; number: string; amount_paise: unknown; created_at: Date; pdf_ref: string | null; cash: boolean }>(
    tx,
    sql`select id, number, amount_paise, created_at, pdf_ref, cash_entry_id is not null as cash from receipts where tenancy_id = ${tenancyId} order by created_at desc`,
  );
  const finalCycle = await one<{ id: string; status: string }>(tx, sql`select id, status from billing_cycles where tenancy_id = ${tenancyId} and kind = 'final'`);
  return {
    ...t,
    rentPaise: toPaise(t.rent_paise),
    depositPaise: toPaise(t.deposit_paise),
    balancePaise: running,
    depositHeldPaise: deposit,
    ledger: entries.reverse(),
    bills: billRows.map((b) => ({ id: b.id, period: b.period, kind: b.kind, cycleId: b.cycle_id, cycleStatus: b.cycle_status, status: b.status, totalPaise: toPaise(b.total_paise), payablePaise: toPaise(b.payable_paise), dueDate: b.due_date })),
    receipts: receiptRows.map((r) => ({ id: r.id, number: r.number, amountPaise: toPaise(r.amount_paise), createdAt: toDate(r.created_at), pdfRef: r.pdf_ref, cash: r.cash })),
    finalCycle,
  };
}

export async function listCycles(tx: Queryable, orgId: string) {
  const rows = await many<{ id: string; property_id: string; property_name: string; period: string; kind: string; status: string; due_date: string; bills: number; total: unknown; anomalies: unknown[]; tenant_name: string | null }>(
    tx,
    sql`select c.id, c.property_id, p.name as property_name, c.period, c.kind, c.status, c.due_date::text as due_date,
               (select count(*)::int from bills b where b.cycle_id = c.id) as bills,
               (select coalesce(sum(b.total_paise), 0) from bills b where b.cycle_id = c.id) as total,
               c.anomalies, t.name as tenant_name
        from billing_cycles c join properties p on p.id = c.property_id
        left join tenancies tc on tc.id = c.tenancy_id left join tenants t on t.id = tc.tenant_id
        where c.org_id = ${orgId} order by c.period desc, p.name, c.kind`,
  );
  return rows.map((r) => ({ ...r, totalPaise: toPaise(r.total), anomalyCount: Array.isArray(r.anomalies) ? r.anomalies.length : 0 }));
}

export async function cycleDetail(tx: Queryable, orgId: string, cycleId: string) {
  const c = await one<{ id: string; property_id: string; property_name: string; period: string; kind: string; status: string; due_date: string; anomalies: { kind: string; message: string; roomLabel: string }[]; approved_at: Date | null }>(
    tx,
    sql`select c.id, c.property_id, p.name as property_name, c.period, c.kind, c.status, c.due_date::text as due_date, c.anomalies, c.approved_at
        from billing_cycles c join properties p on p.id = c.property_id where c.id = ${cycleId} and c.org_id = ${orgId}`,
  );
  if (!c) return null;
  c.approved_at = toDateOrNull(c.approved_at);
  const billRows = await many<{ id: string; tenancy_id: string; tenant_name: string; room: string; bed: string; total_paise: unknown; payable_paise: unknown; status: string; sent_at: Date | null }>(
    tx,
    sql`select b.id, b.tenancy_id, t.name as tenant_name, r.number as room, bd.label as bed, b.total_paise, b.payable_paise, b.status, b.sent_at
        from bills b join tenancies tc on tc.id = b.tenancy_id join tenants t on t.id = tc.tenant_id join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id
        where b.cycle_id = ${cycleId} order by r.number, bd.label`,
  );
  const lineRows = await many<{ id: string; bill_id: string; kind: string; description: string; amount_paise: unknown; manual: boolean; carried: boolean }>(
    tx,
    sql`select l.id, l.bill_id, l.kind, l.description, l.amount_paise, l.manual, l.carried from bill_lines l join bills b on b.id = l.bill_id where b.cycle_id = ${cycleId} order by l.sort`,
  );
  return {
    ...c,
    bills: billRows.map((b) => ({
      id: b.id,
      tenancyId: b.tenancy_id,
      tenantName: b.tenant_name,
      room: b.room,
      bed: b.bed,
      totalPaise: toPaise(b.total_paise),
      payablePaise: toPaise(b.payable_paise),
      status: b.status,
      sentAt: toDateOrNull(b.sent_at),
      lines: lineRows.filter((l) => l.bill_id === b.id).map((l) => ({ id: l.id, kind: l.kind, description: l.description, amountPaise: toPaise(l.amount_paise), manual: l.manual, carried: l.carried })),
    })),
  };
}

/** Meters of a property with the reading for `period` (end of month) and the one before. */
export async function readingsForPeriod(tx: Queryable, orgId: string, propertyId: string, period: Period) {
  const rows = await many<{ meter_id: string; room: string; reading: number | null; photo_ref: string | null; read_at: Date | null; previous: number | null; previous_period: string | null; occupied: number }>(
    tx,
    sql`select m.id as meter_id, r.number as room, cur.reading, cur.photo_ref, cur.read_at, prev.reading as previous, prev.period as previous_period,
               (select count(*)::int from beds b where b.room_id = r.id and b.status in ('occupied', 'notice')) as occupied
        from rooms r join floors f on f.id = r.floor_id join meters m on m.id = r.meter_id
        left join meter_readings cur on cur.meter_id = m.id and cur.kind = 'monthly' and cur.period = ${period}
        left join lateral (select reading, period from meter_readings p where p.meter_id = m.id and p.kind = 'monthly' and p.period < ${period} order by p.period desc limit 1) prev on true
        where r.property_id = ${propertyId} and r.org_id = ${orgId} order by f.sort, r.number`,
  );
  return rows;
}

export async function paymentsOverview(tx: Queryable, orgId: string) {
  const credits = await many<{ id: string; amount_paise: unknown; utr: string | null; payer_name: string | null; payer_vpa: string | null; credited_on: string; status: string; verified: boolean; suggestions: { billId: string; tenancyId: string; reason: string; differencePaise: number }[]; source: string }>(
    tx,
    sql`select id, amount_paise, utr, payer_name, payer_vpa, (credited_at at time zone 'Asia/Kolkata')::date::text as credited_on, status, verified, suggestions, source
        from bank_credits where org_id = ${orgId} and status = 'unmatched' order by credited_at desc`,
  );
  const tenancyNames = await many<{ tenancy_id: string; name: string; room: string }>(
    tx,
    sql`select tc.id as tenancy_id, t.name, r.number || b.label as room from tenancies tc join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id where tc.org_id = ${orgId}`,
  );
  const nameOf = new Map(tenancyNames.map((t) => [t.tenancy_id, `${t.name} (${t.room})`]));
  const matched = await many<{ id: string; amount_paise: unknown; method: string; created_at: Date; tenant: string; room: string; utr: string | null; receipt_number: string | null; confirmed: boolean }>(
    tx,
    sql`select pm.id, pm.amount_paise, pm.method, pm.created_at, t.name as tenant, r.number || bd.label as room, bc.utr, rc.number as receipt_number, pm.confirmed_by is not null as confirmed
        from payment_matches pm join bills b on b.id = pm.bill_id join tenancies tc on tc.id = b.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id
        left join bank_credits bc on bc.id = pm.credit_id left join receipts rc on rc.payment_match_id = pm.id
        where pm.org_id = ${orgId} order by pm.created_at desc limit 50`,
  );
  const claims = await many<{ id: string; tenancy_id: string; screenshot_ref: string; utr_last4: string | null; created_at: Date; flagged_at: Date | null }>(
    tx,
    sql`select id, tenancy_id, screenshot_ref, utr_last4, created_at, flagged_at from payment_claims where org_id = ${orgId} and status = 'claimed' order by created_at desc`,
  );
  const emails = await many<{ id: string; from_address: string; subject: string; body_text: string; received_at: Date }>(
    tx,
    sql`select id, from_address, subject, body_text, received_at from inbound_emails where org_id = ${orgId} and status = 'unparsed' order by received_at desc limit 50`,
  );
  const org = await one<{ token: string; name: string }>(tx, sql`select inbound_email_token as token, name from orgs where id = ${orgId}`);
  const open = await many<{ bill_id: string; tenancy_id: string; payable_paise: unknown; balance: unknown }>(
    tx,
    sql`select * from (select distinct on (b.tenancy_id) b.id as bill_id, b.tenancy_id, b.payable_paise, b.status,
           (select coalesce(sum(e.amount_paise), 0) from ledger_entries e where e.tenancy_id = b.tenancy_id and e.${DUES}) as balance
         from bills b join billing_cycles c on c.id = b.cycle_id where b.org_id = ${orgId} and c.status <> 'draft' order by b.tenancy_id, c.approved_at desc) x
        where status in ('sent', 'partially_paid')`,
  );
  return {
    inboundToken: org?.token ?? "",
    orgName: org?.name ?? "",
    unmatched: credits.map((c) => ({
      id: c.id,
      amountPaise: toPaise(c.amount_paise),
      utr: c.utr,
      payer: [c.payer_name, c.payer_vpa].filter(Boolean).join(" · "),
      creditedOn: c.credited_on,
      verified: c.verified,
      source: c.source,
      suggestions: (c.suggestions ?? []).map((s) => ({ ...s, label: nameOf.get(s.tenancyId) ?? "Unknown" })),
    })),
    matched: matched.map((m) => ({ ...m, created_at: toDate(m.created_at), amountPaise: toPaise(m.amount_paise) })),
    claims: claims.map((c) => ({ ...c, created_at: toDate(c.created_at), flagged_at: toDateOrNull(c.flagged_at), tenant: nameOf.get(c.tenancy_id) ?? "" })),
    unparsed: emails.map((e) => ({ ...e, received_at: toDate(e.received_at) })),
    openBills: open.map((o) => ({ billId: o.bill_id, tenancyId: o.tenancy_id, label: nameOf.get(o.tenancy_id) ?? "", payablePaise: toPaise(o.payable_paise), outstandingPaise: Math.max(0, toPaise(o.balance)) })),
  };
}

export async function cashOverview(tx: Queryable, orgId: string) {
  const rows = await many<{ id: string; amount_paise: unknown; received_on: string; tenant: string; room: string; manager: string | null; manager_id: string; tenant_confirmed_at: Date | null; disputed_at: Date | null; handed_over_at: Date | null; note: string | null }>(
    tx,
    sql`select ce.id, ce.amount_paise, ce.received_on::text as received_on, t.name as tenant, r.number || b.label as room, u.name as manager, u.id as manager_id,
               ce.tenant_confirmed_at, ce.disputed_at, ce.handed_over_at, ce.note
        from cash_entries ce join tenancies tc on tc.id = ce.tenancy_id join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id
        join rooms r on r.id = b.room_id join users u on u.id = ce.recorded_by
        where ce.org_id = ${orgId} order by ce.created_at desc limit 200`,
  );
  const entries = rows.map((r) => ({
    ...r,
    tenant_confirmed_at: toDateOrNull(r.tenant_confirmed_at),
    disputed_at: toDateOrNull(r.disputed_at),
    handed_over_at: toDateOrNull(r.handed_over_at),
    amountPaise: toPaise(r.amount_paise),
  }));
  const inHand = new Map<string, { manager: string; amountPaise: number; ids: string[] }>();
  for (const e of entries) {
    if (!e.tenant_confirmed_at || e.handed_over_at) continue;
    const cur = inHand.get(e.manager_id) ?? { manager: e.manager ?? "Manager", amountPaise: 0, ids: [] };
    cur.amountPaise += e.amountPaise;
    cur.ids.push(e.id);
    inHand.set(e.manager_id, cur);
  }
  return { entries, inHand: [...inHand.values()] };
}

/** Owner home (M7): expected vs collected this month, pending list, unmatched credits, cash in hand. */
/** Owner home (M7). `propertyId` = the property switcher; null = all properties. */
export async function dashboard(tx: Queryable, orgId: string, period: Period, propertyId: string | null = null) {
  const inCycle = propertyId ? sql`and c.property_id = ${propertyId}` : sql``;
  const inTenancy = (col: string) =>
    propertyId
      ? sql`and ${sql.raw(col)} in (select tc.id from tenancies tc join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id where r.property_id = ${propertyId})`
      : sql``;
  const expected = await one<{ total: unknown; charges: unknown }>(
    tx,
    sql`select coalesce(sum(b.total_paise), 0) as total,
               coalesce(sum((select coalesce(sum(l.amount_paise), 0) from bill_lines l where l.bill_id = b.id and not l.carried)), 0) as charges
        from bills b join billing_cycles c on c.id = b.cycle_id
        where b.org_id = ${orgId} and c.period = ${period} and c.kind = 'monthly' and c.status <> 'draft' ${inCycle}`,
  );
  const collected = await one<{ total: unknown; cash: unknown }>(
    tx,
    sql`select coalesce(-sum(amount_paise), 0) as total, coalesce(-sum(amount_paise) filter (where ref_type = 'cash_entry'), 0) as cash
        from ledger_entries where org_id = ${orgId} and type = 'payment' and ref_type <> 'deposit' ${inTenancy("tenancy_id")}
          and (created_at at time zone 'Asia/Kolkata')::date between ${periodStart(period)} and ${periodEnd(period)}`,
  );
  const pending = await many<{ tenancy_id: string; name: string; phone: string; room: string; property: string; balance: unknown; due_date: string; status: string; payable_paise: unknown }>(
    tx,
    sql`select * from (
          select distinct on (b.tenancy_id) b.tenancy_id, t.name, t.phone, r.number || bd.label as room, p.name as property, b.status, b.payable_paise, c.due_date::text as due_date,
                 (select coalesce(sum(e.amount_paise), 0) from ledger_entries e where e.tenancy_id = b.tenancy_id and e.${DUES}) as balance
          from bills b join billing_cycles c on c.id = b.cycle_id join tenancies tc on tc.id = b.tenancy_id join tenants t on t.id = tc.tenant_id
          join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id join properties p on p.id = r.property_id
          where b.org_id = ${orgId} and c.status <> 'draft' and tc.status <> 'closed' ${inCycle}
          order by b.tenancy_id, c.approved_at desc) x
        where status in ('sent', 'partially_paid') order by due_date, room`,
  );
  const unmatched = await one<{ n: number; total: unknown }>(
    tx,
    sql`select count(*)::int as n, coalesce(sum(amount_paise), 0) as total from bank_credits where org_id = ${orgId} and status = 'unmatched'`,
  );
  const occupancy = await one<{ beds: number; occupied: number }>(
    tx,
    sql`select count(*)::int as beds, count(*) filter (where b.status in ('occupied', 'notice'))::int as occupied from beds b where b.org_id = ${orgId}
        ${propertyId ? sql`and b.room_id in (select id from rooms where property_id = ${propertyId})` : sql``}`,
  );
  const drafts = await many<{ id: string; period: string; property: string; anomalies: unknown[] }>(
    tx,
    sql`select c.id, c.period, p.name as property, c.anomalies from billing_cycles c join properties p on p.id = c.property_id where c.org_id = ${orgId} and c.status = 'draft' ${inCycle} order by c.period`,
  );
  // Tenants living in the PG now (on notice still counts: they're still here).
  const tenants = await one<{ n: number }>(
    tx,
    sql`select count(*)::int as n from tenancies tc where tc.org_id = ${orgId} and tc.status in ('active', 'notice') ${inTenancy("tc.id")}`,
  );
  // What this month's approved bills charge, by kind. Carried lines (earlier dues) aren't new charges.
  const kinds = await many<{ kind: string; total: unknown; bills: number }>(
    tx,
    sql`select l.kind, coalesce(sum(l.amount_paise), 0) as total, count(distinct l.bill_id)::int as bills
        from bill_lines l join bills b on b.id = l.bill_id join billing_cycles c on c.id = b.cycle_id
        where b.org_id = ${orgId} and c.period = ${period} and c.kind = 'monthly' and c.status <> 'draft' and not l.carried ${inCycle}
        group by l.kind`,
  );
  const recent = await many<{ id: string; tenancy_id: string; name: string; room: string; property: string; amount: unknown; at: string; ref_type: string; method: string | null; receipt_id: string | null }>(
    tx,
    sql`select e.id, e.tenancy_id, t.name, r.number || bd.label as room, p.name as property, -e.amount_paise as amount,
               (e.created_at at time zone 'Asia/Kolkata')::text as at, e.ref_type, pm.method,
               (select rc.id from receipts rc where rc.payment_match_id = e.ref_id or rc.cash_entry_id = e.ref_id limit 1) as receipt_id
        from ledger_entries e join tenancies tc on tc.id = e.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id join properties p on p.id = r.property_id
        left join payment_matches pm on e.ref_type = 'payment_match' and pm.id = e.ref_id
        where e.org_id = ${orgId} and e.type = 'payment' and e.ref_type <> 'deposit' ${inTenancy("e.tenancy_id")}
          and (e.created_at at time zone 'Asia/Kolkata')::date between ${periodStart(period)} and ${periodEnd(period)}
        order by e.created_at desc limit 8`,
  );
  return {
    period,
    expectedPaise: toPaise(expected?.total),
    newChargesPaise: toPaise(expected?.charges),
    collectedPaise: toPaise(collected?.total),
    collectedCashPaise: toPaise(collected?.cash),
    pending: pending.map((p) => ({ ...p, balancePaise: toPaise(p.balance), payablePaise: toPaise(p.payable_paise) })),
    unmatchedCount: unmatched?.n ?? 0,
    unmatchedPaise: toPaise(unmatched?.total),
    beds: occupancy?.beds ?? 0,
    occupied: occupancy?.occupied ?? 0,
    drafts: drafts.map((d) => ({ ...d, anomalyCount: Array.isArray(d.anomalies) ? d.anomalies.length : 0 })),
    activeTenants: tenants?.n ?? 0,
    /** New charges this month by kind (rent, metered, fixed, service, late_fee, adjustment). */
    breakdown: kinds.map((k) => ({ kind: k.kind, paise: toPaise(k.total), bills: k.bills })),
    recentPayments: recent.map((r) => ({
      id: r.id,
      tenancyId: r.tenancy_id,
      name: r.name,
      room: r.room,
      property: r.property,
      paise: toPaise(r.amount),
      at: r.at,
      method: (r.ref_type === "cash_entry" ? "cash" : r.method === "manual" ? "manual" : "bank") as "cash" | "manual" | "bank",
      receiptId: r.receipt_id,
    })),
  };
}

/** Month-wise collection report: what was charged and what came in, by method. */
export async function collectionReport(tx: Queryable, orgId: string, toPeriod: Period, months = 12) {
  const from = addMonths(toPeriod, -(months - 1));
  const rows = await many<{ period: string; charged: unknown; upi: unknown; cash: unknown; deposit: unknown; adjustments: unknown }>(
    tx,
    sql`select to_char((created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as period,
               coalesce(sum(amount_paise) filter (where type = 'charge'), 0) as charged,
               coalesce(-sum(amount_paise) filter (where type = 'payment' and ref_type = 'payment_match'), 0) as upi,
               coalesce(-sum(amount_paise) filter (where type = 'payment' and ref_type = 'cash_entry'), 0) as cash,
               coalesce(-sum(amount_paise) filter (where type = 'payment' and ref_type = 'deposit'), 0) as deposit,
               coalesce(sum(amount_paise) filter (where type in ('adjustment', 'reversal')), 0) as adjustments
        from ledger_entries where org_id = ${orgId}
          and (created_at at time zone 'Asia/Kolkata')::date between ${periodStart(from)} and ${periodEnd(toPeriod)}
        group by 1 order by 1`,
  );
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  const out = [];
  for (let i = 0; i < months; i++) {
    const p = addMonths(from, i);
    const r = byPeriod.get(p);
    const upi = toPaise(r?.upi);
    const cash = toPaise(r?.cash);
    const deposit = toPaise(r?.deposit);
    out.push({ period: p, chargedPaise: toPaise(r?.charged), upiPaise: upi, cashPaise: cash, depositPaise: deposit, adjustmentsPaise: toPaise(r?.adjustments), collectedPaise: upi + cash + deposit });
  }
  return out;
}

export async function staffList(tx: Queryable, orgId: string) {
  const members = await many<{ user_id: string; name: string | null; phone: string; role: string }>(
    tx,
    sql`select m.user_id, u.name, u.phone, m.role from org_members m join users u on u.id = m.user_id where m.org_id = ${orgId} order by m.role desc, u.name`,
  );
  const access = await many<{ user_id: string; property_id: string; permissions: Record<string, boolean> }>(
    tx,
    sql`select user_id, property_id, permissions from user_property_access where org_id = ${orgId}`,
  );
  return members.map((m) => ({
    userId: m.user_id,
    name: m.name,
    phone: m.phone,
    role: m.role,
    access: access.filter((a) => a.user_id === m.user_id).map((a) => ({ propertyId: a.property_id, permissions: a.permissions })),
  }));
}

export interface AttentionItem {
  key: "drafts" | "unmatched" | "unparsed" | "disputedCash" | "failedMessages" | "noMoney" | "pendingCash";
  count: number;
  /** Where to fix it; null when that screen arrives in a later milestone. */
  href: string | null;
}

/**
 * "Needs attention" counts for the notifications bell. Read under RLS, so a
 * manager only gets what they're allowed to see (bank items are owner-only).
 */
export async function attention(tx: Queryable, orgId: string): Promise<AttentionItem[]> {
  const r = await one<Record<AttentionItem["key"], number>>(
    tx,
    sql`select
          (select count(*)::int from billing_cycles where org_id = ${orgId} and status = 'draft') as "drafts",
          (select count(*)::int from bank_credits where org_id = ${orgId} and status = 'unmatched') as "unmatched",
          (select count(*)::int from inbound_emails where org_id = ${orgId} and status = 'unparsed') as "unparsed",
          (select count(*)::int from cash_entries where org_id = ${orgId} and disputed_at is not null and disputed_at > now() - interval '30 days') as "disputedCash",
          (select count(*)::int from message_log where org_id = ${orgId} and status = 'failed' and created_at > now() - interval '7 days') as "failedMessages",
          (select count(*)::int from payment_claims where org_id = ${orgId} and status = 'claimed' and flagged_at is not null) as "noMoney",
          (select count(*)::int from cash_entries where org_id = ${orgId} and tenant_confirmed_at is null and disputed_at is null) as "pendingCash"`,
  );
  const hrefs: Record<AttentionItem["key"], string | null> = {
    drafts: "/billing",
    unmatched: "/payments",
    unparsed: "/payments#unparsed",
    disputedCash: "/cash",
    // TODO(M10): link to WhatsApp message history.
    failedMessages: null,
    noMoney: "/payments",
    pendingCash: "/cash",
  };
  return (Object.keys(hrefs) as AttentionItem["key"][]).map((key) => ({ key, count: r?.[key] ?? 0, href: hrefs[key] })).filter((i) => i.count > 0);
}

/** The logged-in person's own profile: account, membership, and what they can access. */
export async function myProfile(tx: Queryable, userId: string, orgId: string) {
  const me = await one<{ name: string | null; phone: string; email: string | null; language: Language; role: string; member_since: Date; org_name: string }>(
    tx,
    sql`select u.name, u.phone, u.email, u.language, m.role, m.created_at as member_since, o.name as org_name
        from users u join org_members m on m.user_id = u.id and m.org_id = ${orgId} join orgs o on o.id = m.org_id
        where u.id = ${userId}`,
  );
  if (!me) return null;
  // Owners see every property; managers see the ones granted to them (RLS does the filtering).
  const access = await many<{ property_id: string; name: string; permissions: Record<string, boolean> | null }>(
    tx,
    sql`select p.id as property_id, p.name, a.permissions from properties p
        left join user_property_access a on a.property_id = p.id and a.user_id = ${userId}
        where p.org_id = ${orgId} order by p.name`,
  );
  return { ...me, memberSince: toDate(me.member_since), access: access.map((a) => ({ propertyId: a.property_id, name: a.name, permissions: a.permissions })) };
}
