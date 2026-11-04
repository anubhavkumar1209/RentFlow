/**
 * WhatsApp automations per property (CLAUDE.md G1, H6.8): when bills are
 * drafted and sent, which days reminders and late-payment notices go out, and
 * the owner's short note. Pure: the scheduler in packages/server calls these.
 */
import { addDays, addMonths, dueDateFor, periodOf, type ISODate, type Period } from "./dates";
import { pack } from "./i18n";
import type { Language } from "./languages";

export const AUTOMATION_KEYS = ["bill", "reminder_before", "reminder_due", "reminder_overdue", "payment_confirmation"] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

export interface BillSchedule {
  /** "day": on a fixed day of the month (1–28). "before_due": N days before the due date. */
  mode: "day" | "before_due";
  day: number;
  daysBefore: number;
  /** Hour of the day in India (0–23). */
  hour: number;
  /** true: the owner approves the drafted bills first. false: sent automatically unless something needs a look. */
  approveFirst: boolean;
}
export interface BeforeSchedule {
  daysBefore: number;
  hour: number;
}
export interface DueSchedule {
  hour: number;
}
export interface OverdueSchedule {
  /** Days after the due date. */
  daysAfter: number[];
  /** Keep reminding every 7 days after the last of `daysAfter`, up to 60 days. */
  weekly: boolean;
  hour: number;
}

export interface AutomationSchedules {
  bill: BillSchedule;
  reminder_before: BeforeSchedule;
  reminder_due: DueSchedule;
  reminder_overdue: OverdueSchedule;
  payment_confirmation: Record<string, never>;
}

export interface AutomationConfig<K extends AutomationKey = AutomationKey> {
  key: K;
  enabled: boolean;
  note: string;
  schedule: AutomationSchedules[K];
}

export type PropertyAutomations = { [K in AutomationKey]: AutomationConfig<K> };

export const NOTE_MAX = 120;

/** The defaults match the spec: bills a week before the due date, reminders 2 days before, on the day, +3, +7, then weekly. */
export const DEFAULT_SCHEDULES: AutomationSchedules = {
  bill: { mode: "before_due", day: 1, daysBefore: 7, hour: 9, approveFirst: true },
  reminder_before: { daysBefore: 2, hour: 10 },
  reminder_due: { hour: 10 },
  reminder_overdue: { daysAfter: [3, 7], weekly: true, hour: 10 },
  payment_confirmation: {},
};

/** The note used when the owner hasn't written one, in the tenant's language. */
export function defaultNote(key: AutomationKey, language: Language): string {
  return pack(language).notes[key];
}

const int = (v: unknown, min: number, max: number, fallback: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Reads a stored schedule, falling back to defaults for anything missing or out of range. */
export function parseSchedule<K extends AutomationKey>(key: K, raw: unknown): AutomationSchedules[K] {
  const r = obj(raw);
  const d = DEFAULT_SCHEDULES;
  const schedules: AutomationSchedules = {
    bill: {
      mode: r.mode === "day" ? "day" : r.mode === "before_due" ? "before_due" : d.bill.mode,
      day: int(r.day, 1, 28, d.bill.day),
      daysBefore: int(r.daysBefore, 0, 25, d.bill.daysBefore),
      hour: int(r.hour, 0, 23, d.bill.hour),
      approveFirst: typeof r.approveFirst === "boolean" ? r.approveFirst : d.bill.approveFirst,
    },
    reminder_before: { daysBefore: int(r.daysBefore, 1, 15, d.reminder_before.daysBefore), hour: int(r.hour, 0, 23, d.reminder_before.hour) },
    reminder_due: { hour: int(r.hour, 0, 23, d.reminder_due.hour) },
    reminder_overdue: {
      daysAfter: Array.isArray(r.daysAfter)
        ? [...new Set(r.daysAfter.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b)
        : d.reminder_overdue.daysAfter,
      weekly: typeof r.weekly === "boolean" ? r.weekly : d.reminder_overdue.weekly,
      hour: int(r.hour, 0, 23, d.reminder_overdue.hour),
    },
    payment_confirmation: {},
  };
  return schedules[key];
}

/** One line, at most NOTE_MAX characters (WhatsApp rejects newlines inside template variables). */
export function cleanNote(note: string): string {
  return note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
}

/** Builds the full set for a property from stored rows; missing rows get defaults (enabled). */
export function resolveAutomations(rows: { key: string; enabled: boolean; note: string | null; schedule: unknown }[], language: Language = "en"): PropertyAutomations {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const one = <K extends AutomationKey>(key: K): AutomationConfig<K> => {
    const row = byKey.get(key);
    return { key, enabled: row?.enabled ?? true, note: cleanNote(row?.note ?? "") || defaultNote(key, language), schedule: parseSchedule(key, row?.schedule) };
  };
  return {
    bill: one("bill"),
    reminder_before: one("reminder_before"),
    reminder_due: one("reminder_due"),
    reminder_overdue: one("reminder_overdue"),
    payment_confirmation: one("payment_confirmation"),
  };
}

/** The date on which the bills for `period` are drafted (and, without approval, sent). */
export function billDateFor(period: Period, dueDay: number, s: BillSchedule): ISODate {
  const due = dueDateFor(period, dueDay);
  if (s.mode === "before_due") return addDays(due, -s.daysBefore);
  // A fixed day after the due day belongs to the month before (e.g. bills on the 26th for rent due on the 5th).
  return dueDateFor(s.day <= dueDay ? period : addMonths(period, -1), s.day);
}

/**
 * Which period's bills should be drafted on `today`, if any. Catches up on a
 * missed day (server down, owner paused) until the due date passes; on the bill
 * date itself it waits for the scheduled hour. `hour` undefined = any hour.
 */
export function periodToBill(today: ISODate, dueDay: number, s: BillSchedule, hour?: number): Period | null {
  for (const period of [periodOf(today), addMonths(periodOf(today), 1)]) {
    const billDate = billDateFor(period, dueDay, s);
    const due = dueDateFor(period, dueDay);
    if (today < billDate || today > due) continue;
    if (today === billDate && hour !== undefined && hour < s.hour) continue;
    return period;
  }
  return null;
}

/** A reminder for one bill: its offset from the due date (negative = before) and the automation it belongs to. */
export interface ReminderSlot {
  offset: number;
  key: "reminder_before" | "reminder_due" | "reminder_overdue";
  hour: number;
}

/** Every reminder day the enabled automations ask for, in order. */
export function reminderSlots(a: PropertyAutomations): ReminderSlot[] {
  const slots: ReminderSlot[] = [];
  if (a.reminder_before.enabled) slots.push({ offset: -a.reminder_before.schedule.daysBefore, key: "reminder_before", hour: a.reminder_before.schedule.hour });
  if (a.reminder_due.enabled) slots.push({ offset: 0, key: "reminder_due", hour: a.reminder_due.schedule.hour });
  if (a.reminder_overdue.enabled) {
    const { daysAfter, weekly, hour } = a.reminder_overdue.schedule;
    const after = [...daysAfter];
    if (weekly) for (let d = (after.at(-1) ?? 0) + 7; d <= 60; d += 7) after.push(d);
    for (const d of after) slots.push({ offset: d, key: "reminder_overdue", hour });
  }
  return slots.sort((x, y) => x.offset - y.offset);
}

/** The reminder due for a bill on `today` (at or after its hour), if any. */
export function reminderSlotFor(dueDate: ISODate, slots: ReminderSlot[], today: ISODate, hour?: number): ReminderSlot | null {
  return slots.find((s) => addDays(dueDate, s.offset) === today && (hour === undefined || hour >= s.hour)) ?? null;
}

/** Next date (on or after `today`) a bill reminder would go out, for the monitor. */
export function nextReminderDate(dueDate: ISODate, slots: ReminderSlot[], today: ISODate): { date: ISODate; slot: ReminderSlot } | null {
  for (const slot of slots) {
    const date = addDays(dueDate, slot.offset);
    if (date >= today) return { date, slot };
  }
  return null;
}

export function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? "AM" : "PM"}`;
}
