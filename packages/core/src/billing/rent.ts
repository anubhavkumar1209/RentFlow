import { addDays, daysInMonth, diffDays, maxDate, minDate, periodEnd, periodOf, periodStart, addMonths, type ISODate } from "../dates";
import { assertPaise, type Paise } from "../money";

/**
 * Rent for part of a month (CLAUDE.md §7.9):
 *   rent × days_occupied / days_in_month, rounded to the nearest rupee (half up).
 * A full month is charged exactly, even if the rent has paise.
 */
export function prorateRent(rentPaise: Paise, daysOccupied: number, monthDays: number): Paise {
  assertPaise(rentPaise, "rent");
  if (!Number.isInteger(daysOccupied) || daysOccupied < 0 || daysOccupied > monthDays) {
    throw new RangeError(`daysOccupied must be 0–${monthDays}, got ${daysOccupied}`);
  }
  if (daysOccupied === monthDays) return rentPaise;
  if (daysOccupied === 0) return 0;
  // Integer-only: round(rent × days / monthDays / 100) × 100, half up.
  const numerator = rentPaise * daysOccupied;
  const divisor = monthDays * 100;
  return Math.floor((numerator + divisor / 2) / divisor) * 100;
}

export interface RentSegment {
  start: ISODate;
  end: ISODate;
  days: number;
  monthDays: number;
  amountPaise: Paise;
}

export interface RentSegmentsInput {
  rentPaise: Paise;
  checkIn: ISODate;
  checkOut: ISODate | null;
  /** Last day already covered by an approved rent line; null if never billed. */
  billedUntil: ISODate | null;
  /** Bill rent up to and including this day (end of the billing period, or the check-out day). */
  billThrough: ISODate;
}

/**
 * The not-yet-billed rent for a tenancy, one segment per calendar month, each
 * prorated by that month's own length. Covers mid-month joiners whose first
 * days fall in a month that was already billed.
 */
export function rentSegments(input: RentSegmentsInput): RentSegment[] {
  const start = input.billedUntil ? maxDate(input.checkIn, addDays(input.billedUntil, 1)) : input.checkIn;
  const end = input.checkOut ? minDate(input.checkOut, input.billThrough) : input.billThrough;
  if (start > end) return [];

  const segments: RentSegment[] = [];
  let period = periodOf(start);
  while (periodStart(period) <= end) {
    const segStart = maxDate(start, periodStart(period));
    const segEnd = minDate(end, periodEnd(period));
    const days = diffDays(segStart, segEnd) + 1;
    const monthDays = daysInMonth(period);
    segments.push({ start: segStart, end: segEnd, days, monthDays, amountPaise: prorateRent(input.rentPaise, days, monthDays) });
    period = addMonths(period, 1);
  }
  return segments;
}
