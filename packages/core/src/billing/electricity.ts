import { addDays, overlapDays, type ISODate } from "../dates";
import { assertPaise, type Paise } from "../money";

/**
 * Electricity split by tenant-days (CLAUDE.md §7.10):
 *   tenant_share = room_cost × tenant_days / total_tenant_days_on_meter
 * Each share is rounded down to the paisa; the leftover paise go to the tenant
 * with the most days (first one on a tie), so shares always add up to the cost.
 */
export function splitByTenantDays<K>(costPaise: Paise, shares: { key: K; days: number }[]): { key: K; amountPaise: Paise }[] {
  assertPaise(costPaise, "cost");
  const totalDays = shares.reduce((sum, s) => sum + s.days, 0);
  if (totalDays === 0) return shares.map((s) => ({ key: s.key, amountPaise: 0 }));

  const result = shares.map((s) => ({ key: s.key, amountPaise: Math.floor((costPaise * s.days) / totalDays) }));
  const remainder = costPaise - result.reduce((sum, r) => sum + r.amountPaise, 0);
  if (remainder !== 0) {
    let top = 0;
    shares.forEach((s, i) => {
      if (s.days > (shares[top]?.days ?? 0)) top = i;
    });
    const target = result[top];
    if (target) target.amountPaise += remainder;
  }
  return result;
}

export interface MeterReadingPoint {
  /** The reading covers usage up to the end of this day. */
  date: ISODate;
  value: number;
}

export interface MeterOccupant {
  tenancyId: string;
  checkIn: ISODate;
  checkOut: ISODate | null;
}

export interface MeterSegmentResult {
  start: ISODate;
  end: ISODate;
  units: number;
  costPaise: Paise;
  shares: { tenancyId: string; days: number; amountPaise: Paise }[];
  /** Cost nobody was in the room for (vacant room consuming power). */
  unallocatedPaise: Paise;
  /** True if the meter went backwards; the segment is then charged at zero. */
  negative: boolean;
}

/**
 * Splits a meter's usage between consecutive readings. Each segment runs from
 * the day after one reading to the day of the next, and is split by the days
 * each occupant was in the room during that segment.
 */
export function splitMeterUsage(readings: MeterReadingPoint[], ratePaise: Paise, occupants: MeterOccupant[]): MeterSegmentResult[] {
  assertPaise(ratePaise, "rate");
  const sorted = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const segments: MeterSegmentResult[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr || curr.date === prev.date) continue;
    const start = addDays(prev.date, 1);
    const end = curr.date;
    const rawUnits = curr.value - prev.value;
    const negative = rawUnits < 0;
    const units = negative ? 0 : rawUnits;
    const costPaise = units * ratePaise;
    const days = occupants.map((o) => ({ key: o.tenancyId, days: overlapDays({ start: o.checkIn, end: o.checkOut }, { start, end }) }));
    const split = splitByTenantDays(costPaise, days);
    const anyone = days.some((d) => d.days > 0);
    segments.push({
      start,
      end,
      units,
      costPaise,
      negative,
      unallocatedPaise: anyone ? 0 : costPaise,
      shares: split.map((s, idx) => ({ tenancyId: s.key, days: days[idx]?.days ?? 0, amountPaise: s.amountPaise })),
    });
  }
  return segments;
}
