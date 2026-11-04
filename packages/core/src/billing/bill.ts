import { formatDate, type ISODate } from "../dates";
import { assertPaise, formatINR, type Paise } from "../money";
import type { MeterSegmentResult } from "./electricity";
import type { RentSegment } from "./rent";

export type BillLineKind = "rent" | "fixed" | "metered" | "service" | "previous_due" | "adjustment" | "late_fee";

export interface DraftLine {
  kind: BillLineKind;
  description: string;
  amountPaise: Paise;
  /** What the line came from: tenancy, service, meter or ledger-entry id. */
  sourceId: string | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  /**
   * True if the amount is already in the ledger (previous dues, adjustments made
   * after an earlier approval). Approval only writes the *other* lines as charges.
   */
  carried: boolean;
}

export interface ComposeBillInput {
  tenancyId: string;
  rentSegments: RentSegment[];
  fixedCharges: { serviceId: string; name: string; amountPaise: Paise }[];
  /** Electricity segments for this tenancy's meter; only this tenancy's share is billed. */
  electricity: { meterId: string; ratePaise: Paise; segments: MeterSegmentResult[] } | null;
  /** Ledger balance before this bill (positive = owes, negative = credit), excluding `ledgerAdjustments`. */
  previousDuePaise: Paise;
  /** Adjustments recorded in the ledger since the last approval, shown as their own lines. */
  ledgerAdjustments: { entryId: string; description: string; amountPaise: Paise }[];
  lateFee: { amountPaise: Paise; description: string } | null;
  /** Owner-entered one-off lines (e.g. laundry ₹90 before Phase 2 services exist). */
  extraLines?: { kind: "service" | "adjustment"; description: string; amountPaise: Paise }[];
}

function rentDescription(seg: RentSegment): string {
  if (seg.days === seg.monthDays) return `Rent ${formatDate(seg.start).replace(/^1 /, "")}`;
  return `Rent ${formatDate(seg.start)} – ${formatDate(seg.end)} (${seg.days}/${seg.monthDays} days)`;
}

/** Builds the lines of one tenant's bill from already-computed parts. */
export function composeBill(input: ComposeBillInput): DraftLine[] {
  const lines: DraftLine[] = [];
  const line = (l: Omit<DraftLine, "periodStart" | "periodEnd" | "carried"> & Partial<DraftLine>) =>
    lines.push({ periodStart: null, periodEnd: null, carried: false, ...l });

  if (input.previousDuePaise !== 0) {
    line({
      kind: "previous_due",
      description: input.previousDuePaise > 0 ? "Previous dues" : "Advance / credit from earlier",
      amountPaise: input.previousDuePaise,
      sourceId: input.tenancyId,
      carried: true,
    });
  }
  for (const adj of input.ledgerAdjustments) {
    line({ kind: "adjustment", description: adj.description, amountPaise: adj.amountPaise, sourceId: adj.entryId, carried: true });
  }
  for (const seg of input.rentSegments) {
    line({
      kind: "rent",
      description: rentDescription(seg),
      amountPaise: seg.amountPaise,
      sourceId: input.tenancyId,
      periodStart: seg.start,
      periodEnd: seg.end,
    });
  }
  if (input.electricity) {
    for (const seg of input.electricity.segments) {
      const share = seg.shares.find((s) => s.tenancyId === input.tenancyId);
      if (!share || share.days === 0) continue;
      line({
        kind: "metered",
        description: `Electricity ${formatDate(seg.start)} – ${formatDate(seg.end)}: ${seg.units} units × ${formatINR(input.electricity.ratePaise)} = ${formatINR(seg.costPaise)}, your share ${share.days} days`,
        amountPaise: share.amountPaise,
        sourceId: input.electricity.meterId,
        periodStart: seg.start,
        periodEnd: seg.end,
      });
    }
  }
  for (const fixed of input.fixedCharges) {
    line({ kind: "fixed", description: fixed.name, amountPaise: fixed.amountPaise, sourceId: fixed.serviceId });
  }
  for (const extra of input.extraLines ?? []) {
    line({ kind: extra.kind, description: extra.description, amountPaise: extra.amountPaise, sourceId: null });
  }
  if (input.lateFee && input.lateFee.amountPaise > 0) {
    line({ kind: "late_fee", description: input.lateFee.description, amountPaise: input.lateFee.amountPaise, sourceId: null });
  }
  for (const l of lines) assertPaise(l.amountPaise, l.description);
  return lines;
}

export function billTotal(lines: Pick<DraftLine, "amountPaise">[]): Paise {
  return lines.reduce((sum, l) => sum + l.amountPaise, 0);
}

/** The part of a bill that is new money owed, i.e. what approval writes to the ledger. */
export function newCharges(lines: Pick<DraftLine, "amountPaise" | "carried">[]): Paise {
  return lines.reduce((sum, l) => sum + (l.carried ? 0 : l.amountPaise), 0);
}

export type BillStatus = "draft" | "sent" | "partially_paid" | "paid";

/**
 * Status of a tenancy's latest bill. Earlier dues are carried into each new bill,
 * so payments always settle the oldest money first (CLAUDE.md §7.8).
 */
export function billStatus(input: { payablePaise: Paise; paidSinceApprovalPaise: Paise; balancePaise: Paise }): Exclude<BillStatus, "draft"> {
  if (input.balancePaise <= 0 || input.paidSinceApprovalPaise >= input.payablePaise) return "paid";
  if (input.paidSinceApprovalPaise > 0) return "partially_paid";
  return "sent";
}

export interface LateFeeRule {
  /** Flat fee added to the next bill when the previous bill is still unpaid this many days after the due date. */
  amount_paise: number;
  grace_days: number;
}

export function parseLateFeeRule(raw: unknown): LateFeeRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const amount = r.amount_paise;
  const grace = r.grace_days;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return { amount_paise: amount, grace_days: typeof grace === "number" && grace >= 0 ? Math.floor(grace) : 0 };
}
