/**
 * Payment matching engine (CLAUDE.md §8). Decides what to do with one bank
 * credit, given the open bills and screenshot claims of the same org. Pure: the
 * caller loads the data and applies the decision.
 */
import { diffDays, type ISODate } from "./dates";
import type { Paise } from "./money";

export interface CreditInput {
  amountPaise: Paise;
  utr: string | null;
  payerName: string | null;
  payerVpa: string | null;
  creditedOn: ISODate;
}

export interface OpenBill {
  billId: string;
  tenancyId: string;
  payablePaise: Paise;
  /** What is still owed on this bill. */
  outstandingPaise: Paise;
}

export interface OpenClaim {
  claimId: string;
  tenancyId: string;
  utrLast4: string | null;
  claimedOn: ISODate;
}

export interface PayerAlias {
  tenancyId: string;
  payerName: string | null;
  payerVpa: string | null;
}

export interface MatchContext {
  openBills: OpenBill[];
  openClaims: OpenClaim[];
  aliases: PayerAlias[];
  /** UTRs already recorded for this org (any status). */
  knownUtrs: ReadonlySet<string>;
}

export type MatchMethod = "unique_amount" | "utr_last4";

export type MatchDecision =
  | { action: "auto"; method: MatchMethod; billId: string; tenancyId: string; claimId: string | null }
  | { action: "suggest"; suggestions: Suggestion[] }
  | { action: "reject"; reason: "duplicate_utr" }
  | { action: "none" };

export interface Suggestion {
  billId: string;
  tenancyId: string;
  reason: "payer_alias" | "close_amount";
  /** Distance from the bill's payable amount, for sorting. */
  differencePaise: Paise;
}

/** "± ₹100" from §8. */
export const CLOSE_AMOUNT_PAISE = 10_000;
export const UTR_WINDOW_DAYS = 3;

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function matchCredit(credit: CreditInput, ctx: MatchContext): MatchDecision {
  if (credit.utr && ctx.knownUtrs.has(credit.utr)) return { action: "reject", reason: "duplicate_utr" };

  // 1. Exact unique amount.
  const exact = ctx.openBills.filter((b) => b.payablePaise > 0 && b.payablePaise === credit.amountPaise);
  if (exact.length === 1 && exact[0]) {
    const bill = exact[0];
    const claim = ctx.openClaims.find((c) => c.tenancyId === bill.tenancyId) ?? null;
    return { action: "auto", method: "unique_amount", billId: bill.billId, tenancyId: bill.tenancyId, claimId: claim?.claimId ?? null };
  }

  // 2. Tenant-typed last 4 UTR digits, within ±3 days.
  if (credit.utr) {
    const last4 = credit.utr.slice(-4);
    const claims = ctx.openClaims.filter(
      (c) => c.utrLast4 === last4 && Math.abs(diffDays(c.claimedOn, credit.creditedOn)) <= UTR_WINDOW_DAYS,
    );
    const tenancies = new Set(claims.map((c) => c.tenancyId));
    if (tenancies.size === 1 && claims[0]) {
      const claim = claims[0];
      const bill = ctx.openBills.find((b) => b.tenancyId === claim.tenancyId);
      if (bill) {
        return { action: "auto", method: "utr_last4", billId: bill.billId, tenancyId: bill.tenancyId, claimId: claim.claimId };
      }
    }
  }

  // 3–4. Suggestions for the owner to confirm in one tap.
  const suggestions = new Map<string, Suggestion>();
  const payerName = norm(credit.payerName);
  const payerVpa = norm(credit.payerVpa);
  for (const alias of ctx.aliases) {
    const nameHit = payerName !== "" && norm(alias.payerName) === payerName;
    const vpaHit = payerVpa !== "" && norm(alias.payerVpa) === payerVpa;
    if (!nameHit && !vpaHit) continue;
    for (const bill of ctx.openBills.filter((b) => b.tenancyId === alias.tenancyId)) {
      suggestions.set(bill.billId, {
        billId: bill.billId,
        tenancyId: bill.tenancyId,
        reason: "payer_alias",
        differencePaise: Math.abs(bill.payablePaise - credit.amountPaise),
      });
    }
  }
  for (const bill of ctx.openBills) {
    if (suggestions.has(bill.billId)) continue;
    const diff = Math.min(Math.abs(bill.payablePaise - credit.amountPaise), Math.abs(bill.outstandingPaise - credit.amountPaise));
    if (diff <= CLOSE_AMOUNT_PAISE) {
      suggestions.set(bill.billId, { billId: bill.billId, tenancyId: bill.tenancyId, reason: "close_amount", differencePaise: diff });
    }
  }
  if (suggestions.size > 0) {
    const sorted = [...suggestions.values()].sort(
      (a, b) => (a.reason === b.reason ? a.differencePaise - b.differencePaise : a.reason === "payer_alias" ? -1 : 1),
    );
    return { action: "suggest", suggestions: sorted };
  }
  return { action: "none" };
}

/** Screenshots older than this with no matching credit are flagged "no money received". */
export const CLAIM_TIMEOUT_HOURS = 48;

/** Hamming distance between two 64-bit perceptual hashes written as 16 hex chars. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i] ?? "0", 16) ^ parseInt(b[i] ?? "0", 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/** Two screenshots this close (out of 64 bits) are treated as the same image. */
export const DUPLICATE_HASH_DISTANCE = 4;
