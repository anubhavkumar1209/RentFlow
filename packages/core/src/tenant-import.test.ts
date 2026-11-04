import { describe, expect, it } from "vitest";
import { addMonths, dueDateFor, formatPeriod, overlapDays, periodEnd } from "./dates";
import { parseIndianDate, planRooms, validateTenantImport, type ImportBed } from "./tenant-import";

const beds: ImportBed[] = [
  { bedId: "101A", roomNumber: "101", label: "A", vacant: true, defaultRentPaise: 600000 },
  { bedId: "101B", roomNumber: "101", label: "B", vacant: false, defaultRentPaise: 600000 },
  { bedId: "102A", roomNumber: "102", label: "A", vacant: true, defaultRentPaise: 500000 },
];

describe("validateTenantImport", () => {
  it("accepts good rows and auto-assigns a vacant bed", () => {
    const { ok, errors } = validateTenantImport(
      [{ Name: "Anubhav", Phone: "98765 43210", Room: "101", Bed: "", Rent: "6,000", Deposit: "12000", "Check In": "01/11/2026", "Guardian Phone": "9876500001", Language: "Hindi" }],
      { beds, phonesWithCurrentTenancy: new Set() },
    );
    expect(errors).toEqual([]);
    expect(ok).toEqual([
      { row: 2, name: "Anubhav", phone: "+919876543210", bedId: "101A", roomNumber: "101", bedLabel: "A", rentPaise: 600000, depositPaise: 1200000, checkIn: "2026-11-01", guardianPhones: ["+919876500001"], language: "hi" },
    ]);
  });

  it("reports duplicate phones, full rooms, occupied beds and bad values with row numbers", () => {
    const { ok, errors } = validateTenantImport(
      [
        { name: "A", phone: "9876543210", room: "102", rent: "5000", check_in: "2026-11-01" },
        { name: "B", phone: "+91 98765 43210", room: "102", rent: "5000", check_in: "2026-11-01" },
        { name: "C", phone: "9000000001", room: "101", bed: "B", rent: "5000", check_in: "2026-11-01" },
        { name: "D", phone: "9000000002", room: "102", rent: "abc", check_in: "31/02/2026" },
        { name: "E", phone: "9000000003", room: "999", rent: "5000", check_in: "2026-11-01" },
        { name: "F", phone: "9111111111", room: "101", rent: "5000", check_in: "2026-11-01" },
      ],
      { beds, phonesWithCurrentTenancy: new Set(["+919111111111"]) },
    );
    expect(ok.map((r) => r.name)).toEqual(["A"]);
    expect(errors).toEqual([
      { row: 3, message: "phone +919876543210 appears twice in this file; room 102 is full" },
      { row: 4, message: "bed 101B is already occupied" },
      { row: 5, message: "room 102 is full; rent \"abc\" isn't a valid amount; check_in \"31/02/2026\" isn't a date (use DD/MM/YYYY)" },
      { row: 6, message: "room 999 doesn't exist" },
      { row: 7, message: "phone +919111111111 already has a current tenancy" },
    ]);
  });

  it("parses Indian day-first dates", () => {
    expect(parseIndianDate("5/1/26")).toBe("2026-01-05");
    expect(parseIndianDate("2026-11-02")).toBe("2026-11-02");
    expect(parseIndianDate("13/13/2026")).toBeNull();
  });
});

describe("planRooms", () => {
  it("generates floors 1–3, 10 rooms each, 2-sharing", () => {
    const plan = planRooms({ floorFrom: 1, floorTo: 3, roomsPerFloor: 10, sharing: 2 });
    expect(plan).toHaveLength(30);
    expect(plan[0]).toEqual({ floor: 1, number: "101", sharing: 2, beds: ["A", "B"] });
    expect(plan.at(-1)?.number).toBe("310");
    expect(planRooms({ floorFrom: 0, floorTo: 0, roomsPerFloor: 2, sharing: 1 }).map((r) => r.number)).toEqual(["G01", "G02"]);
  });
});

describe("dates", () => {
  it("does month and overlap arithmetic", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
    expect(dueDateFor("2026-11", 5)).toBe("2026-11-05");
    expect(formatPeriod("2026-11")).toBe("Nov 2026");
    expect(overlapDays({ start: "2026-11-11", end: null }, { start: "2026-11-01", end: "2026-11-30" })).toBe(20);
    expect(overlapDays({ start: "2026-12-01", end: null }, { start: "2026-11-01", end: "2026-11-30" })).toBe(0);
  });
});
