/**
 * Calendar dates without time zones. Dates are ISO strings ("2026-11-02") and
 * billing periods are "YYYY-MM". All arithmetic is done on whole UTC days, so
 * there are no DST or time-zone surprises.
 */

export type ISODate = string;
export type Period = string;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD = /^(\d{4})-(\d{2})$/;

function toUtcMs(date: ISODate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Not an ISO date: ${date}`);
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (fromUtcMs(ms) !== date) throw new RangeError(`Invalid calendar date: ${date}`);
  return ms;
}

function fromUtcMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isISODate(value: string): boolean {
  try {
    toUtcMs(value);
    return true;
  } catch {
    return false;
  }
}

export function isPeriod(value: string): boolean {
  const m = PERIOD.exec(value);
  return Boolean(m && Number(m[2]) >= 1 && Number(m[2]) <= 12);
}

function parsePeriod(period: Period): { year: number; month: number } {
  const m = PERIOD.exec(period);
  if (!m || !isPeriod(period)) throw new RangeError(`Not a period (YYYY-MM): ${period}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function daysInMonth(period: Period): number {
  const { year, month } = parsePeriod(period);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodStart(period: Period): ISODate {
  return `${period}-01`;
}

export function periodEnd(period: Period): ISODate {
  return `${period}-${String(daysInMonth(period)).padStart(2, "0")}`;
}

export function periodOf(date: ISODate): Period {
  toUtcMs(date);
  return date.slice(0, 7);
}

export function addMonths(period: Period, n: number): Period {
  const { year, month } = parsePeriod(period);
  const index = year * 12 + (month - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Number of days two inclusive ranges share. `end: null` means open-ended. */
export function overlapDays(
  a: { start: ISODate; end: ISODate | null },
  b: { start: ISODate; end: ISODate },
): number {
  const start = maxDate(a.start, b.start);
  const end = a.end ? minDate(a.end, b.end) : b.end;
  return start > end ? 0 : diffDays(start, end) + 1;
}

/** The rent due date for a period; due_day is 1–28 so it always exists. */
export function dueDateFor(period: Period, dueDay: number): ISODate {
  return `${period}-${String(dueDay).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" → "Nov 2026" */
export function formatPeriod(period: Period): string {
  const { year, month } = parsePeriod(period);
  return `${MONTHS[month - 1]} ${year}`;
}

/** "2026-11" → "NOV" */
export function periodShortCode(period: Period): string {
  return (MONTHS[parsePeriod(period).month - 1] ?? "").toUpperCase();
}

/** "2026-11-02" → "2 Nov 2026" */
export function formatDate(date: ISODate): string {
  toUtcMs(date);
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Today's date in India (IST), for code that needs "today" at the edges of the system. */
export function todayInIndia(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
