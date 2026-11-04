import { describe, expect, it } from "vitest";
import { billStatus, billTotal, composeBill, newCharges } from "./bill";
import { splitByTenantDays, splitMeterUsage } from "./electricity";
import { meterAnomalies } from "./anomalies";
import { assignPayableAmounts } from "./payable";
import { prorateRent, rentSegments } from "./rent";

const rupees = (r: number) => r * 100;

describe("CLAUDE.md §7 worked example — Room 303, November", () => {
  // Meter read at end of October (prev) and end of November (curr): 120 units × ₹8.
  const readings = [
    { date: "2026-10-31", value: 1000 },
    { date: "2026-11-30", value: 1120 },
  ];
  const occupants = [
    { tenancyId: "anubhav", checkIn: "2026-01-15", checkOut: null },
    { tenancyId: "anmol", checkIn: "2026-11-11", checkOut: null },
  ];
  const segments = splitMeterUsage(readings, rupees(8), occupants);
  const wifi = { serviceId: "wifi", name: "Wi-Fi", amountPaise: rupees(200) };

  function bill(tenancyId: string, rentPaise: number, checkIn: string, extra: { kind: "service"; description: string; amountPaise: number }[] = []) {
    return composeBill({
      tenancyId,
      rentSegments: rentSegments({ rentPaise, checkIn, checkOut: null, billedUntil: "2026-10-31", billThrough: "2026-11-30" }),
      fixedCharges: [wifi],
      electricity: { meterId: "m303", ratePaise: rupees(8), segments },
      previousDuePaise: 0,
      ledgerAdjustments: [],
      lateFee: null,
      extraLines: extra,
    });
  }

  it("splits ₹960 as ₹576 / ₹384 by tenant-days (30 vs 20)", () => {
    expect(segments).toHaveLength(1);
    expect(segments[0]?.costPaise).toBe(rupees(960));
    expect(segments[0]?.shares).toEqual([
      { tenancyId: "anubhav", days: 30, amountPaise: rupees(576) },
      { tenancyId: "anmol", days: 20, amountPaise: rupees(384) },
    ]);
  });

  it("Anubhav: 2,000 + 576 + 200 + 90 = ₹2,866", () => {
    const lines = bill("anubhav", rupees(2000), "2026-01-15", [{ kind: "service", description: "Laundry", amountPaise: rupees(90) }]);
    expect(lines.map((l) => [l.kind, l.amountPaise])).toEqual([
      ["rent", rupees(2000)],
      ["metered", rupees(576)],
      ["fixed", rupees(200)],
      ["service", rupees(90)],
    ]);
    expect(billTotal(lines)).toBe(rupees(2866));
  });

  it("Anmol: 2,667 + 384 + 200 = ₹3,251", () => {
    const lines = bill("anmol", rupees(4000), "2026-11-11");
    expect(lines.find((l) => l.kind === "rent")?.amountPaise).toBe(rupees(2667));
    expect(billTotal(lines)).toBe(rupees(3251));
  });
});

describe("prorateRent", () => {
  it("charges a full month exactly, even with paise", () => {
    expect(prorateRent(200050, 30, 30)).toBe(200050);
  });
  it("rounds to the nearest rupee, half up", () => {
    expect(prorateRent(rupees(4000), 20, 30)).toBe(rupees(2667)); // 2666.67
    expect(prorateRent(rupees(3000), 1, 2 * 1 + 28)).toBe(rupees(100));
    expect(prorateRent(rupees(31), 15, 31)).toBe(rupees(15)); // 15.0
    expect(prorateRent(rupees(62), 15, 31)).toBe(rupees(30)); // 30.0
    expect(prorateRent(rupees(7), 1, 2)).toBe(rupees(4)); // 3.5 → 4
  });
  it("is zero for zero days and rejects impossible input", () => {
    expect(prorateRent(rupees(5000), 0, 30)).toBe(0);
    expect(() => prorateRent(rupees(5000), 31, 30)).toThrow(RangeError);
    expect(() => prorateRent(10.5, 3, 30)).toThrow(TypeError);
  });
});

describe("rentSegments", () => {
  it("bills a mid-month joiner's first days in the month they joined, plus the new month", () => {
    const segs = rentSegments({ rentPaise: rupees(6000), checkIn: "2026-10-21", checkOut: null, billedUntil: null, billThrough: "2026-11-30" });
    expect(segs).toEqual([
      { start: "2026-10-21", end: "2026-10-31", days: 11, monthDays: 31, amountPaise: rupees(2129) }, // 2129.03
      { start: "2026-11-01", end: "2026-11-30", days: 30, monthDays: 30, amountPaise: rupees(6000) },
    ]);
  });
  it("continues from the last billed day and stops at check-out", () => {
    const segs = rentSegments({ rentPaise: rupees(6000), checkIn: "2026-01-01", checkOut: "2026-11-10", billedUntil: "2026-10-31", billThrough: "2026-11-30" });
    expect(segs).toEqual([{ start: "2026-11-01", end: "2026-11-10", days: 10, monthDays: 30, amountPaise: rupees(2000) }]);
  });
  it("returns nothing when everything is already billed", () => {
    expect(rentSegments({ rentPaise: 1, checkIn: "2026-01-01", checkOut: null, billedUntil: "2026-11-30", billThrough: "2026-11-30" })).toEqual([]);
  });
  it("handles February in a leap year", () => {
    const [seg] = rentSegments({ rentPaise: rupees(2900), checkIn: "2028-02-15", checkOut: null, billedUntil: null, billThrough: "2028-02-29" });
    expect(seg).toMatchObject({ days: 15, monthDays: 29, amountPaise: rupees(1500) });
  });
});

describe("splitByTenantDays", () => {
  it("always adds up to the cost; remainder goes to the tenant with most days", () => {
    const shares = splitByTenantDays(100, [
      { key: "a", days: 10 },
      { key: "b", days: 11 },
      { key: "c", days: 10 },
    ]);
    expect(shares.reduce((s, x) => s + x.amountPaise, 0)).toBe(100);
    expect(shares).toEqual([
      { key: "a", amountPaise: 32 },
      { key: "b", amountPaise: 36 },
      { key: "c", amountPaise: 32 },
    ]);
  });
  it("gives the remainder to the first tenant on a tie", () => {
    expect(splitByTenantDays(100, [{ key: "a", days: 1 }, { key: "b", days: 1 }, { key: "c", days: 1 }]).map((s) => s.amountPaise)).toEqual([34, 33, 33]);
  });
  it("charges nobody when nobody stayed", () => {
    expect(splitByTenantDays(5000, [{ key: "a", days: 0 }])).toEqual([{ key: "a", amountPaise: 0 }]);
  });
});

describe("splitMeterUsage", () => {
  const occupants = [
    { tenancyId: "a", checkIn: "2026-01-01", checkOut: null },
    { tenancyId: "b", checkIn: "2026-01-01", checkOut: "2026-11-10" },
  ];
  it("splits a check-out reading into its own segment", () => {
    const segs = splitMeterUsage(
      [
        { date: "2026-10-31", value: 100 },
        { date: "2026-11-10", value: 140 },
        { date: "2026-11-30", value: 200 },
      ],
      rupees(10),
      occupants,
    );
    expect(segs.map((s) => [s.start, s.end, s.units, s.shares.map((x) => x.amountPaise)])).toEqual([
      ["2026-11-01", "2026-11-10", 40, [rupees(200), rupees(200)]],
      ["2026-11-11", "2026-11-30", 60, [rupees(600), 0]],
    ]);
  });
  it("charges zero when the meter goes backwards and reports it", () => {
    const segs = splitMeterUsage([{ date: "2026-10-31", value: 500 }, { date: "2026-11-30", value: 400 }], rupees(8), occupants);
    expect(segs[0]).toMatchObject({ units: 0, costPaise: 0, negative: true });
    expect(meterAnomalies({ meterId: "m", roomLabel: "101", segments: segs, history: [] }).map((a) => a.kind)).toEqual(["reading_lower"]);
  });
  it("flags power used in a vacant room and unusually high usage", () => {
    const segs = splitMeterUsage([{ date: "2026-10-31", value: 0 }, { date: "2026-11-30", value: 300 }], rupees(8), []);
    expect(segs[0]?.unallocatedPaise).toBe(rupees(2400));
    expect(meterAnomalies({ meterId: "m", roomLabel: "101", segments: segs, history: [100, 120] }).map((a) => a.kind)).toEqual([
      "vacant_consumption",
      "high_usage",
    ]);
  });
  it("flags a missing reading", () => {
    expect(meterAnomalies({ meterId: "m", roomLabel: "101", segments: null, history: [] })[0]?.kind).toBe("missing_reading");
  });
});

describe("composeBill: previous dues and adjustments", () => {
  it("carries dues and post-approval adjustments without charging them twice", () => {
    const lines = composeBill({
      tenancyId: "t",
      rentSegments: [{ start: "2026-11-01", end: "2026-11-30", days: 30, monthDays: 30, amountPaise: rupees(5000) }],
      fixedCharges: [],
      electricity: null,
      previousDuePaise: rupees(1200),
      ledgerAdjustments: [{ entryId: "e1", description: "Wi-Fi refund for October outage", amountPaise: -rupees(100) }],
      lateFee: { amountPaise: rupees(100), description: "Late fee (October)" },
    });
    expect(billTotal(lines)).toBe(rupees(6200));
    expect(newCharges(lines)).toBe(rupees(5100)); // rent + late fee only
    expect(lines.filter((l) => l.carried).map((l) => l.kind)).toEqual(["previous_due", "adjustment"]);
  });
});

describe("assignPayableAmounts (unique payable)", () => {
  it("adds 1–99 paise to the rupee-rounded total, unique per property", () => {
    const result = assignPayableAmounts(
      [
        { key: "a", totalPaise: rupees(2866) },
        { key: "b", totalPaise: rupees(2866) },
        { key: "c", totalPaise: 325150 },
      ],
      [],
    );
    expect([...result.values()]).toEqual([286601, 286602, 325101]);
  });
  it("never charges more than 99 paise extra, and steps the rupee down when 99 are taken", () => {
    const taken = Array.from({ length: 99 }, (_, i) => rupees(1000) + i + 1);
    const result = assignPayableAmounts([{ key: "x", totalPaise: rupees(1000) }], taken);
    expect(result.get("x")).toBe(rupees(999) + 1);
  });
  it("gives 0 to bills with nothing to pay and skips amounts already in use", () => {
    const result = assignPayableAmounts([{ key: "credit", totalPaise: -500 }, { key: "y", totalPaise: 50000 }], [50001]);
    expect(result.get("credit")).toBe(0);
    expect(result.get("y")).toBe(50002);
  });
  it("keeps every payable unique across 250 identical bills", () => {
    const bills = Array.from({ length: 250 }, (_, i) => ({ key: i, totalPaise: rupees(5000) }));
    const values = [...assignPayableAmounts(bills, []).values()];
    expect(new Set(values).size).toBe(250);
    expect(Math.max(...values)).toBeLessThan(rupees(5001));
  });
});

describe("billStatus", () => {
  it("is paid once the payable amount (or the whole balance) is in", () => {
    expect(billStatus({ payablePaise: 286601, paidSinceApprovalPaise: 286601, balancePaise: -1 })).toBe("paid");
    expect(billStatus({ payablePaise: 286601, paidSinceApprovalPaise: 100000, balancePaise: 186600 })).toBe("partially_paid");
    expect(billStatus({ payablePaise: 286601, paidSinceApprovalPaise: 0, balancePaise: 286600 })).toBe("sent");
    expect(billStatus({ payablePaise: 286601, paidSinceApprovalPaise: 0, balancePaise: 0 })).toBe("paid");
  });
});
