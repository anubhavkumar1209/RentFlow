import { addDays, type ISODate } from "./dates";

/** §9 default: two days before, on the day, three and seven days after. */
export const DEFAULT_REMINDER_OFFSETS = [-2, 0, 3, 7];

export function parseReminderOffsets(raw: unknown): number[] {
  const offsets = (raw as { offsets_days?: unknown } | null)?.offsets_days;
  if (!Array.isArray(offsets)) return DEFAULT_REMINDER_OFFSETS;
  const valid = offsets.filter((o): o is number => Number.isInteger(o) && o >= -30 && o <= 60);
  return valid.length > 0 ? [...new Set(valid)].sort((a, b) => a - b) : DEFAULT_REMINDER_OFFSETS;
}

/** Which reminder (offset in days from the due date) falls on `today`, if any. */
export function reminderOffsetFor(dueDate: ISODate, offsets: number[], today: ISODate): number | null {
  return offsets.find((o) => addDays(dueDate, o) === today) ?? null;
}
