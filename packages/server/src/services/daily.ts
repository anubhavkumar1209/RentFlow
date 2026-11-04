/**
 * The automation run (every hour in production via pg-boss; a button in demo mode).
 *   1. Monthly bill automation: draft the bills on the owner's bill day and hour,
 *      then either ask the owner to approve or, if they chose so, send them.
 *   2. Reminders and late-payment notices on the configured days, until paid.
 *   3. Flag screenshots with no money after 48 hours.
 * `hour` (0–23, India time) is the current hour; undefined = "any hour" (demo, tests).
 */
import {
  formatDate,
  formatINR,
  formatPeriod,
  pack,
  periodToBill,
  reminderSlotFor,
  reminderSlots,
  todayInIndia,
  type ISODate,
  type Language,
} from "@rentflow/core";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { automationStateForProperty } from "./automation";
import { approveCycleAs, buildMonthlyDraft } from "./billing";
import { sendMessage } from "./notify";
import { alertOwners, flagStaleClaims } from "./payments";
import { billToken } from "./receipts";

export interface DailyResult {
  today: ISODate;
  draftsCreated: number;
  /** Of those drafts, how many were approved and sent without waiting for the owner. */
  autoSent: number;
  remindersSent: number;
  claimsFlagged: number;
}

export async function runDaily(deps: AppDeps, today: ISODate = todayInIndia(deps.now()), options: { hour?: number } = {}): Promise<DailyResult> {
  const bills = await runBillAutomation(deps, today, options.hour);
  return {
    today,
    ...bills,
    remindersSent: await sendReminders(deps, today, options.hour),
    claimsFlagged: await flagStaleClaims(deps),
  };
}

/** The current hour in India, for the hourly run. */
export function hourInIndia(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
}

async function runBillAutomation(deps: AppDeps, today: ISODate, hour?: number): Promise<{ draftsCreated: number; autoSent: number }> {
  const props = await many<{ id: string; org_id: string; name: string; due_day: number }>(deps.db, sql`select id, org_id, name, due_day from properties where status <> 'paused' order by created_at`);
  let draftsCreated = 0;
  let autoSent = 0;
  for (const p of props) {
    const state = await automationStateForProperty(deps.db, p.id);
    if (!state || state.paused || !state.automations.bill.enabled) continue;
    const schedule = state.automations.bill.schedule;
    const period = periodToBill(today, p.due_day, schedule, hour);
    if (!period) continue;
    const exists = await one<{ id: string }>(deps.db, sql`select id from billing_cycles where property_id = ${p.id} and period = ${period} and kind = 'monthly'`);
    if (exists) continue;
    const cycleId = await buildMonthlyDraft(deps, { orgId: p.org_id, userId: null }, p.id, period);
    draftsCreated += 1;
    const month = formatPeriod(period);
    if (schedule.approveFirst) {
      await alertOwners(deps, p.org_id, p.name, `The ${month} bills are drafted. Please check meter readings and approve them in RentFlow; they go out on WhatsApp as soon as you approve.`);
      continue;
    }
    // Sent without the owner's tap only when nothing needs a look (missing or odd meter readings).
    const cycle = await one<{ anomalies: unknown[] | null; bills: unknown }>(
      deps.db,
      sql`select anomalies, (select count(*) from bills b where b.cycle_id = c.id and b.total_paise > 0) as bills from billing_cycles c where id = ${cycleId}`,
    );
    const issues = Array.isArray(cycle?.anomalies) ? cycle.anomalies.length : 0;
    if (issues > 0 || Number(cycle?.bills ?? 0) === 0) {
      await alertOwners(deps, p.org_id, p.name, `The ${month} bills are drafted but weren't sent automatically: ${issues > 0 ? `${issues} meter reading${issues === 1 ? "" : "s"} need a look` : "there are no bills"}. Please review and approve them in RentFlow.`);
      continue;
    }
    await approveCycleAs(deps, { orgId: p.org_id, userId: null }, cycleId);
    autoSent += 1;
  }
  return { draftsCreated, autoSent };
}

async function sendReminders(deps: AppDeps, today: ISODate, hour?: number): Promise<number> {
  const open = await many<{
    bill_id: string; org_id: string; tenancy_id: string; property_id: string; due_date: string; period: string; payable_paise: unknown; balance: unknown;
    phone: string; language: Language; property_name: string; wa_phone_number_id: string | null; status: string;
  }>(deps.db, sqlOpenBillsForReminders);
  const states = new Map<string, Awaited<ReturnType<typeof automationStateForProperty>>>();
  let sent = 0;
  for (const b of open) {
    const key = `${b.property_id}:${b.language}`;
    if (!states.has(key)) states.set(key, await automationStateForProperty(deps.db, b.property_id, b.language));
    const state = states.get(key);
    if (!state || state.paused) continue;
    const slot = reminderSlotFor(b.due_date, reminderSlots(state.automations), today, hour);
    if (!slot) continue;
    const balance = toPaise(b.balance);
    if (balance <= 0) continue;
    // Any earlier attempt (even a failed one) counts: failures are retried by the owner from the monitor, not every hour.
    const already = await one<{ id: string }>(deps.db, sqlReminderSent(b.bill_id, slot.offset));
    if (already) continue;
    // Partial payers are reminded of what is left, not the whole bill.
    const amount = b.status === "partially_paid" ? balance : toPaise(b.payable_paise);
    const offset = slot.offset;
    const due = pack(b.language).due;
    const when = offset < 0 ? due.before(formatDate(b.due_date)) : offset === 0 ? due.today : due.overdue(formatDate(b.due_date));
    try {
      await sendMessage(
        deps,
        { phone: b.phone, orgId: b.org_id, tenancyId: b.tenancy_id, phoneNumberId: b.wa_phone_number_id },
        {
          kind: "template",
          name: "rf_reminder",
          language: b.language,
          variables: [b.property_name, formatINR(amount), formatPeriod(b.period), when, state.automations[slot.key].note],
          urlSuffix: billToken(deps.config.receiptSecret, b.bill_id),
        },
        { billId: b.bill_id, offset, automation: slot.key },
      );
      sent += 1;
    } catch {
      // Logged as failed in message_log and shown on the WhatsApp Automation screen with a Retry button.
    }
  }
  return sent;
}

const sqlOpenBillsForReminders = sql`
  select * from (
    select distinct on (b.tenancy_id) b.id as bill_id, b.org_id, b.tenancy_id, r.property_id, c.due_date::text as due_date, c.period, b.payable_paise, b.status,
           (select coalesce(sum(e.amount_paise), 0) from ledger_entries e where e.tenancy_id = b.tenancy_id and e.type in ('charge', 'payment', 'reversal', 'adjustment')) as balance,
           t.phone, t.language, p.name as property_name, p.wa_phone_number_id
    from bills b join billing_cycles c on c.id = b.cycle_id join tenancies tc on tc.id = b.tenancy_id join tenants t on t.id = tc.tenant_id
    join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id join properties p on p.id = r.property_id
    where c.status <> 'draft' and tc.status <> 'closed' and p.status <> 'paused'
    order by b.tenancy_id, c.approved_at desc
  ) latest where status in ('sent', 'partially_paid')`;
const sqlReminderSent = (billId: string, offset: number) =>
  sql`select id from message_log where template_name = 'rf_reminder' and payload->>'billId' = ${billId} and (payload->>'offset')::int = ${offset} limit 1`;
