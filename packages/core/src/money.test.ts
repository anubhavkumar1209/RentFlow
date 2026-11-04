import { describe, expect, it } from "vitest";
import { assertPaise, formatINR, parseRupeesToPaise } from "./money";

describe("formatINR", () => {
  it.each([
    [0, "₹0"],
    [5, "₹0.05"],
    [100, "₹1"],
    [286600, "₹2,866"],
    [325100, "₹3,251"],
    [12500037, "₹1,25,000.37"],
    [123456789, "₹12,34,567.89"],
    [10000000000, "₹10,00,00,000"],
    [-50000, "-₹500"],
  ])("formats %i paise as %s", (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it("can always show paise", () => {
    expect(formatINR(286600, { alwaysShowPaise: true })).toBe("₹2,866.00");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatINR(10.5)).toThrow(TypeError);
    expect(() => assertPaise(Number.NaN)).toThrow(TypeError);
  });
});

describe("parseRupeesToPaise", () => {
  it.each([
    ["2866", 286600],
    ["2,866", 286600],
    ["₹1,25,000.37", 12500037],
    ["₹ 500.5", 50050],
    ["0.01", 1],
    [" 960 ", 96000],
  ])("parses %s", (input, expected) => {
    expect(parseRupeesToPaise(input)).toBe(expected);
  });

  it("avoids float rounding errors", () => {
    // 0.29 * 100 === 28.999999999999996 in floating point.
    expect(parseRupeesToPaise("0.29")).toBe(29);
    expect(parseRupeesToPaise("1.15")).toBe(115);
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12.", ".5"])("rejects %j", (input) => {
    expect(parseRupeesToPaise(input)).toBeNull();
  });
});
