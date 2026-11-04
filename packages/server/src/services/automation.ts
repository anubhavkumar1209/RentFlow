/**
 * WhatsApp Automation (CLAUDE.md H6.8): per-property on/off, schedules and
 * notes, "Pause all", the monitor (what went out, what was paid) and retrying
 * failed messages. The scheduler that acts on these lives in daily.ts.
 */
import {
  addMonths,
  AUTOMATION_KEYS,
  billDateFor,
  cleanNote,
  dueDateFor,
  formatDate,
  formatINR,
  formatPeriod,
  isLanguage,
  parseSchedule,
  paymentDetailsLine,
  periodOf,
  renderTemplate,
  resolveAutomations,
  todayInIndia,
  type AutomationKey,
  type BotLanguage,
  type ISODate,
  type PropertyAutomations,
  type TemplateName,
} from "@rentflow/core";
import { automations, bills, messageLog, properties, type Queryable } from "@rentflow/db";
import { and, eq, sql } from "drizzle-orm";
import { assertPropertyInOrg, ForbiddenError, requireOwner, UserError, type Actor } from "../actor";
import type { AppDeps, OutboundMessage } from "../ports";
import { many, one, toPaise } from "../sql";
import { sendMessage } from "./notify";

/** Templates each automation sends, for the monitor. */
export const AUTOMATION_TEMPLATES: Record<AutomationKey, TemplateName> = {
  bill: "rf_bill",
  reminder_before: "rf_reminder",
  reminder_due: "rf_reminder",
  reminder_overdue: "rf_reminder",
  payment_confirmation: "rf_payment_received",
};

export interface AutomationState {
  propertyId: string;
  /** Property paused (no cycles at all) or the owner's "Pause all" for WhatsApp. */
  paused: boolean;
  automations: PropertyAutomations;
}

async function stateFor(db: Queryable, propertyId: string, language: BotLanguage): Promise<AutomationState | null> {
  const p = await one<{ id: string; status: string; automations_paused: boolean }>(db, sql`select id, status, automations_paused from properties where id = ${propertyId}`);
  if (!p) return null;
  const rows = await many<{ key: string; enabled: boolean; custom_note: string | null; schedule: unknown }>(
    db,
    sql`select key, enabled, custom_note, schedule from automations where property_id = ${propertyId}`,
  );
  return {
    propertyId,
    paused: p.automations_paused || p.status === "paused",
    automations: resolveAutomations(rows.map((r) => ({ key: r.key, enabled: r.enabled, note: r.custom_note, schedule: r.schedule })), language),
  };
}

export function automationStateForProperty(db: Queryable, propertyId: string, language: BotLanguage = "en"): Promise<AutomationState | null> {
  return stateFor(db, propertyId, language);
}

export async function automationStateForTenancy(db: Queryable, tenancyId: string, language: BotLanguage = "en"): Promise<AutomationState | null> {
  const row = await one<{ property_id: string }>(
    db,
    sql`select r.property_id from tenancies tc join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id where tc.id = ${tenancyId}`,
  );
  return row ? stateFor(db, row.property_id, language) : null;
}

// ─── Owner settings ─────────────────────────────────────────────────────────

export interface AutomationInput {
  enabled: boolean;
  note: string;
  schedule: Record<string, unknown>;
}

export async function saveAutomation(deps: AppDeps, actor: Actor, propertyId: string, key: AutomationKey, input: AutomationInput): Promise<void> {
  requireOwner(actor);
  await assertPropertyInOrg(deps.db, actor, propertyId);
  if (!AUTOMATION_KEYS.includes(key)) throw new UserError("Unknown automation.");
  const schedule = parseSchedule(key, input.schedule);
  if (key === "reminder_overdue" && "daysAfter" in schedule && schedule.daysAfter.length === 0 && !schedule.weekly) {
    throw new UserError("Choose at least one day for late-payment notices, or switch them off.");
  }
  const note = cleanNote(input.note) || null;
  await deps.db
    .insert(automations)
    .values({ orgId: actor.orgId, propertyId, key, enabled: input.enabled, customNote: note, schedule })
    .onConflictDoUpdate({ target: [automations.propertyId, automations.key], set: { enabled: input.enabled, customNote: note, schedule } });
}

/** "Pause all" / "Resume". Resuming sends what was held back: approved bills and receipts not yet sent. */
export async function setAutomationsPaused(deps: AppDeps, actor: Actor, propertyId: string, paused: boolean): Promise<{ resumed: number }> {
  requireOwner(actor);
  await assertPropertyInOrg(deps.db, actor, propertyId);
  await deps.db.update(properties).set({ automationsPaused: paused }).where(and(eq(properties.id, propertyId), eq(properties.orgId, actor.orgId)));
  if (paused) return { resumed: 0 };
  const cycles = await many<{ id: string }>(
    deps.db,
    sql`select c.id from billing_cycles c where c.property_id = ${propertyId} and c.status = 'approved'
          and exists (select 1 from bills b where b.cycle_id = c.id and b.sent_at is null and b.total_paise > 0)`,
  );
  for (const c of cycles) await deps.jobs.send("bills.send", { cycleId: c.id });
  const held = await many<{ id: string }>(
    deps.db,
    sql`select rc.id from receipts rc join tenancies tc on tc.id = rc.tenancy_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        where r.property_id = ${propertyId} and rc.sent_at is null and rc.created_at > now() - interval '7 days'`,
  );
  for (const r of held) await deps.jobs.send("receipt.send", { receiptId: r.id });
  return { resumed: cycles.length + held.length };
}

/** Sends a failed message again, exactly as it was. The old row is marked "retried". */
export async function retryMessage(deps: AppDeps, actor: Actor, logId: string): Promise<void> {
  requireOwner(actor);
  const row = await one<{ phone: string; tenancy_id: string | null; status: string; payload: Record<string, unknown>; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select l.phone, l.tenancy_id, l.status, l.payload, p.wa_phone_number_id
        from message_log l
        left join tenancies tc on tc.id = l.tenancy_id left join beds b on b.id = tc.bed_id left join rooms r on r.id = b.room_id left join properties p on p.id = r.property_id
        where l.id = ${logId} and l.org_id = ${actor.orgId} and l.direction = 'out'`,
  );
  if (!row) throw new ForbiddenError();
  if (row.status !== "failed") throw new UserError("Only failed messages can be sent again.");
  const message = toOutbound(row.payload);
  if (!message) throw new UserError("This message can't be sent again.");
  const { billId, offset, automation, receiptId } = row.payload;
  await deps.db.update(messageLog).set({ status: "retried" }).where(eq(messageLog.id, logId));
  await sendMessage(deps, { phone: row.phone, orgId: actor.orgId, tenancyId: row.tenancy_id, phoneNumberId: row.wa_phone_number_id }, message, { billId, offset, automation, receiptId });
  if (message.kind === "template" && message.name === "rf_bill" && typeof billId === "string") {
    await deps.db.update(bills).set({ sentAt: deps.now() }).where(and(eq(bills.id, billId), eq(bills.orgId, actor.orgId)));
  }
}

/** Rebuilds an outbound message from what notify.ts logged. */
function toOutbound(p: Record<string, unknown>): OutboundMessage | null {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (p.kind) {
    case "template":
      return {
        kind: "template",
        name: p.name as TemplateName,
        language: isLanguage(p.language) ? p.language : "en",
        variables: Array.isArray(p.variables) ? p.variables.map(String) : [],
        ...(Array.isArray(p.buttonIds) ? { buttonIds: p.buttonIds.map(String) } : {}),
        ...(str(p.urlSuffix) ? { urlSuffix: str(p.urlSuffix) } : {}),
        ...(p.header && typeof p.header === "object" ? { header: p.header as { kind: "image" | "document"; fileKey: string; filename?: string } } : {}),
      };
    case "text":
      return str(p.text) ? { kind: "text", text: str(p.text)! } : null;
    case "image":
      return str(p.fileKey) ? { kind: "image", fileKey: str(p.fileKey)!, caption: str(p.caption) } : null;
    case "document":
      return str(p.fileKey) ? { kind: "document", fileKey: str(p.fileKey)!, filename: str(p.filename) ?? "file.pdf", caption: str(p.caption) } : null;
    default:
      return null;
  }
}

// ─── Monitor ────────────────────────────────────────────────────────────────

export type AutomationHealth = "active" | "off" | "paused" | "attention";

export interface AutomationOverview {
  property: { id: string; name: string; dueDay: number; upiVpa: string | null; payeeName: string; upiPhone: string | null; paused: boolean; propertyPaused: boolean };
  automations: PropertyAutomations;
  health: Record<AutomationKey, AutomationHealth>;
  /** Messages per automation in the last 30 days. */
  counts: Record<AutomationKey, { sent: number; delivered: number; read: number; failed: number }>;
  nextBill: { period: string; date: ISODate } | null;
  cycle: {
    id: string;
    period: string;
    status: string;
    dueDate: ISODate;
    bills: number;
    sent: number;
    paid: { count: number; paise: number };
    partial: { count: number; paise: number };
    unpaid: { count: number; paise: number };
    confirming: number;
  } | null;
  recent: { id: string; at: string; tenant: string | null; room: string | null; template: string | null; status: string; error: string | null; automation: AutomationKey | null }[];
  previews: Record<AutomationKey, string>;
  previewVars: Record<AutomationKey, string[]>;
}

const TEMPLATE_KEYS: Record<string, AutomationKey[]> = {
  rf_bill: ["bill"],
  rf_reminder: ["reminder_before", "reminder_due", "reminder_overdue"],
  rf_payment_received: ["payment_confirmation"],
};

export async function automationOverview(deps: AppDeps, actor: Actor, propertyId: string): Promise<AutomationOverview> {
  requireOwner(actor);
  await assertPropertyInOrg(deps.db, actor, propertyId);
  const db = deps.db;
  const p = await one<{ id: string; name: string; due_day: number; upi_vpa: string | null; payee_name: string | null; upi_phone: string | null; automations_paused: boolean; status: string }>(
    db,
    sql`select id, name, due_day, upi_vpa, payee_name, upi_phone, automations_paused, status from properties where id = ${propertyId}`,
  );
  if (!p) throw new ForbiddenError();
  const state = (await stateFor(db, propertyId, "en"))!;
  const a = state.automations;
  const today = todayInIndia(deps.now());

  // Messages from the last 30 days, grouped by template and by the automation recorded with them.
  const logRows = await many<{ template_name: string; automation: string | null; status: string; n: unknown }>(
    db,
    sql`select l.template_name, l.payload->>'automation' as automation, l.status, count(*) as n
        from message_log l join tenancies tc on tc.id = l.tenancy_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        where r.property_id = ${propertyId} and l.direction = 'out' and l.template_name in ('rf_bill', 'rf_reminder', 'rf_payment_received')
          and l.created_at > now() - interval '30 days'
        group by 1, 2, 3`,
  );
  const counts = Object.fromEntries(AUTOMATION_KEYS.map((k) => [k, { sent: 0, delivered: 0, read: 0, failed: 0 }])) as AutomationOverview["counts"];
  for (const r of logRows) {
    const keys = TEMPLATE_KEYS[r.template_name] ?? [];
    const key = (keys.includes(r.automation as AutomationKey) ? r.automation : keys[0]) as AutomationKey | undefined;
    if (!key) continue;
    const n = Number(r.n);
    const c = counts[key];
    if (r.status === "failed") c.failed += n;
    else if (r.status === "read") c.read += n;
    else if (r.status === "delivered") c.delivered += n;
    else if (r.status !== "retried") c.sent += n;
  }
  const failedRecently = await many<{ template_name: string; automation: string | null }>(
    db,
    sql`select distinct l.template_name, l.payload->>'automation' as automation
        from message_log l join tenancies tc on tc.id = l.tenancy_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        where r.property_id = ${propertyId} and l.status = 'failed' and l.created_at > now() - interval '7 days'`,
  );
  const health = Object.fromEntries(
    AUTOMATION_KEYS.map((k) => {
      const failing = failedRecently.some((f) => (TEMPLATE_KEYS[f.template_name] ?? []).includes(k) && (!f.automation || f.automation === k));
      return [k, !a[k].enabled ? "off" : state.paused ? "paused" : failing ? "attention" : "active"];
    }),
  ) as Record<AutomationKey, AutomationHealth>;

  // Next bill date per the schedule (this month or the next two).
  let nextBill: AutomationOverview["nextBill"] = null;
  for (const period of [periodOf(today), addMonths(periodOf(today), 1), addMonths(periodOf(today), 2)]) {
    const date = billDateFor(period, p.due_day, a.bill.schedule);
    const exists = await one<{ id: string }>(db, sql`select id from billing_cycles where property_id = ${propertyId} and period = ${period} and kind = 'monthly'`);
    if (!exists && date >= today) {
      nextBill = { period, date };
      break;
    }
  }

  const c = await one<{ id: string; period: string; status: string; due_date: string }>(
    db,
    sql`select id, period, status, due_date::text as due_date from billing_cycles where property_id = ${propertyId} and kind = 'monthly' order by period desc limit 1`,
  );
  let cycle: AutomationOverview["cycle"] = null;
  if (c) {
    const rows = await many<{ status: string; payable_paise: unknown; balance: unknown; sent: boolean; claims: unknown }>(
      db,
      sql`select b.status, b.payable_paise, b.sent_at is not null as sent,
                 (select coalesce(sum(e.amount_paise), 0) from ledger_entries e where e.tenancy_id = b.tenancy_id and e.type in ('charge', 'payment', 'reversal', 'adjustment')) as balance,
                 (select count(*) from payment_claims pc where pc.tenancy_id = b.tenancy_id and pc.status = 'claimed') as claims
          from bills b where b.cycle_id = ${c.id} and b.total_paise > 0`,
    );
    const sum = (filter: (r: (typeof rows)[number]) => boolean, paise: (r: (typeof rows)[number]) => number) => {
      const list = rows.filter(filter);
      return { count: list.length, paise: list.reduce((s, r) => s + paise(r), 0) };
    };
    cycle = {
      id: c.id,
      period: c.period,
      status: c.status,
      dueDate: c.due_date,
      bills: rows.length,
      sent: rows.filter((r) => r.sent).length,
      paid: sum((r) => r.status === "paid", (r) => toPaise(r.payable_paise)),
      partial: sum((r) => r.status === "partially_paid", (r) => Math.max(0, toPaise(r.balance))),
      unpaid: sum((r) => r.status === "sent", (r) => toPaise(r.payable_paise)),
      confirming: rows.filter((r) => r.status !== "paid" && Number(r.claims) > 0).length,
    };
  }

  const recentRows = await many<{ id: string; created_at: string; tenant: string | null; room: string | null; template_name: string | null; status: string; payload: Record<string, unknown> }>(
    db,
    sql`select l.id, l.created_at::text, t.name as tenant, r.number || b.label as room, l.template_name, l.status, l.payload
        from message_log l join tenancies tc on tc.id = l.tenancy_id join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        where r.property_id = ${propertyId} and l.direction = 'out' and l.template_name in ('rf_bill', 'rf_reminder', 'rf_payment_received')
        order by l.created_at desc limit 25`,
  );
  const recent = recentRows.map((r) => {
    const keys = TEMPLATE_KEYS[r.template_name ?? ""] ?? [];
    const automation = (keys.includes(r.payload.automation as AutomationKey) ? r.payload.automation : keys[0] ?? null) as AutomationKey | null;
    return { id: r.id, at: r.created_at, tenant: r.tenant, room: r.room, template: r.template_name, status: r.status, error: typeof r.payload.error === "string" ? r.payload.error : null, automation };
  });

  const payeeName = p.payee_name ?? p.name;
  return {
    property: { id: p.id, name: p.name, dueDay: p.due_day, upiVpa: p.upi_vpa, payeeName, upiPhone: p.upi_phone, paused: state.paused, propertyPaused: p.status === "paused" },
    automations: a,
    health,
    counts,
    nextBill,
    cycle,
    recent,
    previews: previewMessages({ name: p.name, dueDay: p.due_day, upiVpa: p.upi_vpa, payeeName, upiPhone: p.upi_phone }, a, today),
    previewVars: previewVariables({ name: p.name, dueDay: p.due_day, upiVpa: p.upi_vpa, payeeName, upiPhone: p.upi_phone }, today),
  };
}

type PreviewProperty = { name: string; dueDay: number; upiVpa: string | null; payeeName: string; upiPhone: string | null };

/** Example template variables for each automation's preview, without the note (always the last variable). */
export function previewVariables(p: PreviewProperty, today: ISODate): Record<AutomationKey, string[]> {
  const period = addMonths(periodOf(today), 1);
  const due = formatDate(dueDateFor(period, p.dueDay));
  const month = formatPeriod(period);
  const amount = formatINR(650012);
  const details = paymentDetailsLine({ vpa: p.upiVpa, payeeName: p.payeeName, upiPhone: p.upiPhone }, "en");
  return {
    bill: [p.name, month, formatINR(650000), amount, due, "Rent ₹6,000 · Electricity ₹300 · Wi-Fi ₹200", details],
    reminder_before: [p.name, amount, month, `is due on ${due}`],
    reminder_due: [p.name, amount, month, "is due today"],
    reminder_overdue: [p.name, amount, month, `was due on ${due} and is overdue`],
    payment_confirmation: [p.name, amount, "RCT-00042", formatINR(0)],
  };
}

/** What each automation's message looks like for this PG, with example tenant amounts. */
export function previewMessages(p: PreviewProperty, a: PropertyAutomations, today: ISODate): Record<AutomationKey, string> {
  const vars = previewVariables(p, today);
  return Object.fromEntries(AUTOMATION_KEYS.map((k) => [k, renderTemplate(AUTOMATION_TEMPLATES[k], "en", [...vars[k], a[k].note])])) as Record<AutomationKey, string>;
}
