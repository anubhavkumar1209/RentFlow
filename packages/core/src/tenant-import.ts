/**
 * CSV/Excel tenant import (M2): validates rows before anything is written.
 * Columns (header names are case-insensitive): name, phone, room, bed, rent,
 * deposit, check_in, guardian_phone, language. `bed` may be blank to take the
 * first vacant bed in the room.
 */
import { toLanguage, type Language } from "./languages";
import { isISODate, type ISODate } from "./dates";
import { parseRupeesToPaise, type Paise } from "./money";
import { normalizePhone } from "./phone";

export interface ImportBed {
  bedId: string;
  roomNumber: string;
  label: string;
  vacant: boolean;
  defaultRentPaise: Paise;
}

export interface ImportRowOk {
  row: number;
  name: string;
  phone: string;
  bedId: string;
  roomNumber: string;
  bedLabel: string;
  rentPaise: Paise;
  depositPaise: Paise;
  checkIn: ISODate;
  guardianPhones: string[];
  language: Language;
}

export interface ImportError {
  row: number;
  message: string;
}

export const IMPORT_COLUMNS = ["name", "phone", "room", "bed", "rent", "deposit", "check_in", "guardian_phone", "language"] as const;

/** Accepts 2026-11-02, 02/11/2026, 02-11-2026, 2/11/26 (day first, as in India). */
export function parseIndianDate(raw: string): ISODate | null {
  const s = raw.trim();
  if (isISODate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const year = m[3]?.length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[2]?.padStart(2, "0")}-${m[1]?.padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

export function validateTenantImport(
  rows: Record<string, string>[],
  ctx: { beds: ImportBed[]; phonesWithCurrentTenancy: ReadonlySet<string> },
): { ok: ImportRowOk[]; errors: ImportError[] } {
  const ok: ImportRowOk[] = [];
  const errors: ImportError[] = [];
  const takenBeds = new Set(ctx.beds.filter((b) => !b.vacant).map((b) => b.bedId));
  const seenPhones = new Set<string>();

  rows.forEach((raw, index) => {
    const row = index + 2; // +1 for the header row, +1 for 1-based numbering
    const get = (key: string) => {
      const entry = Object.entries(raw).find(([k]) => k.trim().toLowerCase().replace(/[\s-]+/g, "_") === key);
      return (entry?.[1] ?? "").trim();
    };
    if (Object.values(raw).every((v) => !String(v ?? "").trim())) return; // blank line
    const problems: string[] = [];

    const name = get("name");
    if (!name) problems.push("name is missing");

    const phone = normalizePhone(get("phone"));
    if (!phone) problems.push(`phone "${get("phone")}" is not a valid mobile number`);
    else if (seenPhones.has(phone)) problems.push(`phone ${phone} appears twice in this file`);
    else if (ctx.phonesWithCurrentTenancy.has(phone)) problems.push(`phone ${phone} already has a current tenancy`);

    const roomNumber = get("room");
    const label = get("bed");
    const roomBeds = ctx.beds.filter((b) => b.roomNumber.toLowerCase() === roomNumber.toLowerCase());
    let bed: ImportBed | undefined;
    if (!roomNumber) problems.push("room is missing");
    else if (roomBeds.length === 0) problems.push(`room ${roomNumber} doesn't exist`);
    else if (label) {
      bed = roomBeds.find((b) => b.label.toLowerCase() === label.toLowerCase());
      if (!bed) problems.push(`room ${roomNumber} has no bed ${label}`);
      else if (takenBeds.has(bed.bedId)) problems.push(`bed ${roomNumber}${label} is already occupied`);
    } else {
      bed = roomBeds.find((b) => !takenBeds.has(b.bedId));
      if (!bed) problems.push(`room ${roomNumber} is full`);
    }

    const rentRaw = get("rent");
    const rentPaise = rentRaw ? parseRupeesToPaise(rentRaw) : (bed?.defaultRentPaise ?? null);
    if (rentPaise === null || rentPaise <= 0) problems.push(rentRaw ? `rent "${rentRaw}" isn't a valid amount` : "rent is missing");

    const depositRaw = get("deposit");
    const depositPaise = depositRaw ? parseRupeesToPaise(depositRaw) : 0;
    if (depositPaise === null) problems.push(`deposit "${depositRaw}" isn't a valid amount`);

    const checkIn = parseIndianDate(get("check_in"));
    if (!checkIn) problems.push(`check_in "${get("check_in")}" isn't a date (use DD/MM/YYYY)`);

    const guardianPhones: string[] = [];
    for (const g of get("guardian_phone").split(/[;,/]/).map((s) => s.trim()).filter(Boolean)) {
      const n = normalizePhone(g);
      if (n) guardianPhones.push(n);
      else problems.push(`guardian phone "${g}" is not valid`);
    }

    const langRaw = get("language").toLowerCase();
    const language = toLanguage(langRaw);

    if (problems.length > 0 || !phone || !bed || rentPaise === null || depositPaise === null || !checkIn) {
      errors.push({ row, message: problems.join("; ") });
      return;
    }
    seenPhones.add(phone);
    takenBeds.add(bed.bedId);
    ok.push({ row, name, phone, bedId: bed.bedId, roomNumber: bed.roomNumber, bedLabel: bed.label, rentPaise, depositPaise, checkIn, guardianPhones, language });
  });
  return { ok, errors };
}

export interface RoomPlan {
  floor: number;
  number: string;
  sharing: number;
  beds: string[];
}

/**
 * Bulk room generator: "Floors 1–3, rooms 01–10 on each, 2-sharing" →
 * 101…110, 201…210, 301…310 with beds A, B.
 */
export function planRooms(input: { floorFrom: number; floorTo: number; roomsPerFloor: number; sharing: number; startAt?: number }): RoomPlan[] {
  const { floorFrom, floorTo, roomsPerFloor, sharing } = input;
  if (floorFrom < 0 || floorTo < floorFrom || floorTo > 50) throw new RangeError("Floors must be between 0 and 50");
  if (roomsPerFloor < 1 || roomsPerFloor > 99) throw new RangeError("Rooms per floor must be 1–99");
  if (sharing < 1 || sharing > 26) throw new RangeError("Sharing must be 1–26");
  const startAt = input.startAt ?? 1;
  const beds = Array.from({ length: sharing }, (_, i) => String.fromCharCode(65 + i));
  const plans: RoomPlan[] = [];
  for (let floor = floorFrom; floor <= floorTo; floor++) {
    for (let r = 0; r < roomsPerFloor; r++) {
      const n = startAt + r;
      const number = floor === 0 ? `G${String(n).padStart(2, "0")}` : `${floor}${String(n).padStart(2, "0")}`;
      plans.push({ floor, number, sharing, beds });
    }
  }
  return plans;
}
