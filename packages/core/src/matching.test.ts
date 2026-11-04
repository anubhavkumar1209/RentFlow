import { describe, expect, it } from "vitest";
import { hashDistance, matchCredit, type MatchContext } from "./matching";

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  openBills: [
    { billId: "b1", tenancyId: "t1", payablePaise: 286601, outstandingPaise: 286600 },
    { billId: "b2", tenancyId: "t2", payablePaise: 325102, outstandingPaise: 325100 },
  ],
  openClaims: [],
  aliases: [],
  knownUtrs: new Set(),
  ...over,
});
const credit = { amountPaise: 286601, utr: "630612345678", payerName: "ANUBHAV KUMAR", payerVpa: "anubhav@okaxis", creditedOn: "2026-11-05" };

describe("matchCredit", () => {
  it("auto-settles an exact unique amount", () => {
    expect(matchCredit(credit, ctx())).toEqual({ action: "auto", method: "unique_amount", billId: "b1", tenancyId: "t1", claimId: null });
  });

  it("links the tenant's open screenshot claim when auto-settling", () => {
    const decision = matchCredit(credit, ctx({ openClaims: [{ claimId: "c1", tenancyId: "t1", utrLast4: null, claimedOn: "2026-11-05" }] }));
    expect(decision).toMatchObject({ action: "auto", claimId: "c1" });
  });

  it("rejects a UTR that was already recorded", () => {
    expect(matchCredit(credit, ctx({ knownUtrs: new Set([credit.utr]) }))).toEqual({ action: "reject", reason: "duplicate_utr" });
  });

  it("auto-settles by last-4 UTR digits within ±3 days", () => {
    const off = { ...credit, amountPaise: 300000 };
    const claim = { claimId: "c2", tenancyId: "t2", utrLast4: "5678", claimedOn: "2026-11-03" };
    expect(matchCredit(off, ctx({ openClaims: [claim] }))).toMatchObject({ action: "auto", method: "utr_last4", billId: "b2", claimId: "c2" });
    expect(matchCredit(off, ctx({ openClaims: [{ ...claim, claimedOn: "2026-11-01" }] })).action).not.toBe("auto");
  });

  it("doesn't auto-settle by UTR when two tenants typed the same last 4 digits", () => {
    const off = { ...credit, amountPaise: 1 };
    const claims = [
      { claimId: "c1", tenancyId: "t1", utrLast4: "5678", claimedOn: "2026-11-05" },
      { claimId: "c2", tenancyId: "t2", utrLast4: "5678", claimedOn: "2026-11-05" },
    ];
    expect(matchCredit(off, ctx({ openClaims: claims })).action).toBe("none");
  });

  it("suggests a remembered payer first, then close amounts (± ₹100)", () => {
    const off = { ...credit, amountPaise: 250000, payerVpa: "anmol@ybl", payerName: "Someone" };
    const decision = matchCredit(off, ctx({ aliases: [{ tenancyId: "t1", payerName: null, payerVpa: "ANMOL@ybl" }] }));
    expect(decision).toMatchObject({ action: "suggest" });
    if (decision.action === "suggest") {
      expect(decision.suggestions.map((s) => [s.billId, s.reason])).toEqual([["b1", "payer_alias"]]);
    }
    const close = matchCredit({ ...off, payerVpa: null, amountPaise: 325000 }, ctx());
    expect(close).toMatchObject({ action: "suggest", suggestions: [{ billId: "b2", reason: "close_amount" }] });
  });

  it("does nothing when two bills have the same payable (shouldn't happen, never guess)", () => {
    const dup = ctx({ openBills: [{ billId: "x", tenancyId: "t1", payablePaise: 100, outstandingPaise: 100 }, { billId: "y", tenancyId: "t2", payablePaise: 100, outstandingPaise: 100 }] });
    expect(matchCredit({ ...credit, amountPaise: 100, payerName: null, payerVpa: null }, dup).action).toBe("suggest");
  });

  it("returns none when nothing fits", () => {
    expect(matchCredit({ ...credit, amountPaise: 999999999, payerName: null, payerVpa: null }, ctx()).action).toBe("none");
  });
});

describe("hashDistance", () => {
  it("counts differing bits", () => {
    expect(hashDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hashDistance("ffffffffffffffff", "fffffffffffffffe")).toBe(1);
    expect(hashDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hashDistance("00", "000")).toBe(Number.POSITIVE_INFINITY);
  });
});
