import { describe, expect, it } from "vitest";
import { parseBankDate, parseBankEmail } from "./index";
import { BANK_FIXTURES } from "./fixtures";

describe("bank parsers (fixtures)", () => {
  it.each(BANK_FIXTURES.map((f) => [f.name, f] as const))("%s", (_name, fixture) => {
    expect(parseBankEmail(fixture.email)).toEqual(fixture.expected);
  });
});

describe("parseBankEmail", () => {
  it("returns null for debit alerts and unrelated email", () => {
    expect(parseBankEmail({ from: "alerts@hdfcbank.net", subject: "Debit", text: "Rs.500.00 has been debited from account **1234 to VPA shop@ybl on 02-11-26." })).toBeNull();
    expect(parseBankEmail({ from: "news@example.com", subject: "Hello", text: "Our new offers are here!" })).toBeNull();
  });

  it("copes with forwarded, quoted emails", () => {
    const text = "---------- Forwarded message ---------\n> Dear Customer,\n> Rs.2866.42 has been credited to your account **1234 by VPA anubhav@okaxis ANUBHAV KUMAR on 02-11-26.\n> Your UPI transaction reference number is 630612345678.";
    expect(parseBankEmail({ from: "owner@gmail.com", subject: "Fwd: alert", text })).toMatchObject({ bank: "hdfc", amountPaise: 286642, utr: "630612345678" });
  });
});

describe("parseBankDate", () => {
  it.each([
    ["02-11-26", "2026-11-02"],
    ["02/11/2026", "2026-11-02"],
    ["02-Nov-26", "2026-11-02"],
    ["2 November 2026", "2026-11-02"],
    ["2026-11-02", "2026-11-02"],
    ["31-02-2026", null],
    [undefined, null],
  ])("%s → %s", (raw, expected) => {
    expect(parseBankDate(raw)).toBe(expected);
  });
});
