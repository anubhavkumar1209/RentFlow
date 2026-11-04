import { formatINR, type Paise } from "../money";
import type { MeterSegmentResult } from "./electricity";

export type AnomalyKind = "reading_lower" | "high_usage" | "vacant_consumption" | "missing_reading";

export interface Anomaly {
  kind: AnomalyKind;
  meterId: string;
  roomLabel: string;
  message: string;
}

export interface MeterCheckInput {
  meterId: string;
  roomLabel: string;
  /** Null when a reading needed for this cycle hasn't been entered. */
  segments: MeterSegmentResult[] | null;
  /** Units used in each of the previous few billing months, for the "unusually high" check. */
  history: number[];
}

/** Usage above this multiple of the recent average is flagged. */
export const HIGH_USAGE_FACTOR = 2;

export function meterAnomalies(input: MeterCheckInput): Anomaly[] {
  const base = { meterId: input.meterId, roomLabel: input.roomLabel };
  if (!input.segments) {
    return [{ ...base, kind: "missing_reading", message: `Room ${input.roomLabel}: meter reading missing` }];
  }
  const out: Anomaly[] = [];
  const units = input.segments.reduce((sum, s) => sum + s.units, 0);
  if (input.segments.some((s) => s.negative)) {
    out.push({ ...base, kind: "reading_lower", message: `Room ${input.roomLabel}: reading is lower than the previous one (charged as 0 units)` });
  }
  const unallocated: Paise = input.segments.reduce((sum, s) => sum + s.unallocatedPaise, 0);
  if (unallocated > 0) {
    out.push({ ...base, kind: "vacant_consumption", message: `Room ${input.roomLabel}: ${formatINR(unallocated)} of power used while vacant` });
  }
  const recent = input.history.filter((u) => u > 0);
  if (recent.length > 0) {
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (units > avg * HIGH_USAGE_FACTOR) {
      out.push({ ...base, kind: "high_usage", message: `Room ${input.roomLabel}: ${units} units vs. usual ~${Math.round(avg)}` });
    }
  }
  return out;
}
