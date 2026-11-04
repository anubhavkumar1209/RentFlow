import { describe, expect, it } from "vitest";
import {
  billDateFor,
  cleanNote,
  DEFAULT_SCHEDULES,
  nextReminderDate,
  parseSchedule,
  periodToBill,
  reminderSlotFor,
  reminderSlots,
  resolveAutomations,
  type BillSchedule,
} from "./automation";
import { formatUpiPhone, paymentDetailsLine, upiAppLinks } from "./upi";

const onDay = (day: number, hour = 9): BillSchedule => ({ mode: "day", day, daysBefore: 7, hour, approveFirst: true });
const before = (daysBefore: number, hour = 9): BillSchedule => ({ mode: "before_due", day: 1, daysBefore, hour, approveFirst: true });

describe("bill schedule", () => {
  it("bills on the 1st for rent due on the 5th of the same month", () => {
    expect(billDateFor("2026-12", 5, onDay(1))).toBe("2026-12-01");
    expect(periodToBill("2026-12-01", 5, onDay(1), 9)).toBe("2026-12");
  });

  it("a bill day after the due day belongs to the month before", () => {
    expect(billDateFor("2027-01", 5, onDay(26))).toBe("2026-12-26");
    expect(periodToBill("2026-12-26", 5, onDay(26))).toBe("2027-01");
  });

  it("N days before the due date can cross into the previous month (the spec default)", () => {
    expect(billDateFor("2027-01", 5, before(7))).toBe("2026-12-29");
    expect(periodToBill("2026-12-29", 5, DEFAULT_SCHEDULES.bill)).toBe("2027-01");
  });

  it("waits for the owner's hour on the bill day, then any hour on catch-up days", () => {
    expect(periodToBill("2026-12-01", 5, onDay(1, 18), 9)).toBeNull();
    expect(periodToBill("2026-12-01", 5, onDay(1, 18), 18)).toBe("2026-12");
    expect(periodToBill("2026-12-03", 5, onDay(1, 18), 2)).toBe("2026-12");
  });

  it("never bills before the bill date or after the due date", () => {
    expect(periodToBill("2026-11-30", 5, onDay(1))).toBeNull();
    expect(periodToBill("2026-12-06", 5, onDay(1))).toBeNull();
  });
});

describe("reminders", () => {
  const all = resolveAutomations([]);

  it("default days: 2 before, on the day, +3, +7, then weekly up to 60 days", () => {
    expect(reminderSlots(all).map((s) => s.offset)).toEqual([-2, 0, 3, 7, 14, 21, 28, 35, 42, 49, 56]);
  });

  it("switched-off automations send nothing", () => {
    const some = resolveAutomations([
      { key: "reminder_before", enabled: false, note: null, schedule: {} },
      { key: "reminder_overdue", enabled: true, note: null, schedule: { daysAfter: [5], weekly: false } },
    ]);
    expect(reminderSlots(some).map((s) => [s.offset, s.key])).toEqual([[0, "reminder_due"], [5, "reminder_overdue"]]);
  });

  it("fires on the right day at or after its hour", () => {
    const slots = reminderSlots(all);
    expect(reminderSlotFor("2027-01-05", slots, "2027-01-03", 9)).toBeNull();
    expect(reminderSlotFor("2027-01-05", slots, "2027-01-03", 10)?.key).toBe("reminder_before");
    expect(reminderSlotFor("2027-01-05", slots, "2027-01-08")?.key).toBe("reminder_overdue");
    expect(reminderSlotFor("2027-01-05", slots, "2027-01-09")).toBeNull();
    expect(nextReminderDate("2027-01-05", slots, "2027-01-06")).toMatchObject({ date: "2027-01-08", slot: { offset: 3 } });
  });
});

describe("settings", () => {
  it("bad stored values fall back to defaults", () => {
    expect(parseSchedule("bill", { mode: "weird", day: 31, hour: 25, approveFirst: "yes" })).toEqual(DEFAULT_SCHEDULES.bill);
    expect(parseSchedule("reminder_overdue", { daysAfter: [7, 3, 3, 0, 99] }).daysAfter).toEqual([3, 7]);
  });

  it("notes are one line, at most 120 characters, with a default when empty", () => {
    expect(cleanNote("  Pay\nsoon  please ")).toBe("Pay soon please");
    expect(cleanNote("x".repeat(200))).toHaveLength(120);
    expect(resolveAutomations([{ key: "bill", enabled: true, note: "  ", schedule: {} }]).bill.note).toBe("Please pay by the due date. Thank you!");
  });
});

describe("UPI", () => {
  const pay = { vpa: "sunrise@okhdfc", payeeName: "Sunrise PG", amountPaise: 286642, note: "RF-303A-NOV" };

  it("app links carry the same pre-filled payment", () => {
    const links = upiAppLinks(pay);
    expect(links.map((l) => l.label)).toEqual(["PhonePe", "Google Pay", "Paytm"]);
    for (const l of links) expect(l.href).toContain("pa=sunrise%40okhdfc&pn=Sunrise%20PG&am=2866.42&tn=RF-303A-NOV&cu=INR");
  });

  it("shows the UPI number only when it is a valid mobile number", () => {
    expect(formatUpiPhone("+91 98765 43210")).toBe("98765 43210");
    expect(formatUpiPhone("12345")).toBeNull();
    expect(paymentDetailsLine({ vpa: pay.vpa, payeeName: "Sunrise PG", upiPhone: "9876543210" }, "en")).toBe("UPI ID: sunrise@okhdfc · Name: Sunrise PG · UPI number: 98765 43210");
    expect(paymentDetailsLine({ vpa: pay.vpa, payeeName: "Sunrise PG", upiPhone: null }, "en")).toBe("UPI ID: sunrise@okhdfc · Name: Sunrise PG");
  });
});
