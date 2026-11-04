import { describe, expect, it } from "vitest";
import { formatPhone, isE164, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["0091 9876543210", "+919876543210"],
    ["+44 7700 900123", "+447700900123"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "12345", "5876543210", "+91 5876543210", "98765432101", "+0123456789", "abcdefghij"])(
    "rejects %j",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("isE164 / formatPhone", () => {
  it("validates E.164", () => {
    expect(isE164("+919876543210")).toBe(true);
    expect(isE164("9876543210")).toBe(false);
  });

  it("formats Indian numbers for display", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
  });
});
