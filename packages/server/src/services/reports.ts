/**
 * M7: CSV and Excel exports. Amounts are written as exact rupee strings
 * ("2866.01") from integer paise; Excel cells get the same value as a number
 * for summing (display/export only — no money logic happens here).
 */
import { formatPeriod, paiseToUpiAmount, type Period } from "@rentflow/core";
import type { Queryable } from "@rentflow/db";
import ExcelJS from "exceljs";
import { collectionReport, listTenants, tenantDetail } from "../queries";

export interface Sheet {
  name: string;
  columns: { header: string; key: string; money?: boolean }[];
  rows: Record<string, string | number | null>[];
}

function cell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Quote, and neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(sheet: Sheet): string {
  const lines = [sheet.columns.map((c) => cell(c.header)).join(",")];
  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((c) => (c.money && typeof row[c.key] === "number" ? paiseToUpiAmount(row[c.key] as number) : cell(row[c.key] ?? null))).join(","));
  }
  // Byte-order mark so Excel opens the ₹ sign and Hindi names correctly.
  return `${String.fromCharCode(0xfeff)}${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RentFlow";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, c.header.length + 2), style: c.money ? { numFmt: "₹#,##,##0.00" } : {} }));
    for (const row of s.rows) {
      ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, c.money && typeof row[c.key] === "number" ? Number(paiseToUpiAmount(row[c.key] as number)) : row[c.key]])));
    }
    ws.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function collectionSheet(tx: Queryable, orgId: string, toPeriod: Period): Promise<Sheet> {
  const rows = await collectionReport(tx, orgId, toPeriod, 12);
  return {
    name: "Collections",
    columns: [
      { header: "Month", key: "month" },
      { header: "Charged", key: "charged", money: true },
      { header: "UPI received", key: "upi", money: true },
      { header: "Cash received", key: "cash", money: true },
      { header: "From deposits", key: "deposit", money: true },
      { header: "Total collected", key: "collected", money: true },
      { header: "Adjustments", key: "adjustments", money: true },
    ],
    rows: rows.map((r) => ({ month: formatPeriod(r.period), charged: r.chargedPaise, upi: r.upiPaise, cash: r.cashPaise, deposit: r.depositPaise, collected: r.collectedPaise, adjustments: r.adjustmentsPaise })),
  };
}

export async function tenantsSheet(tx: Queryable, orgId: string): Promise<Sheet> {
  const rows = await listTenants(tx, orgId);
  return {
    name: "Tenants",
    columns: [
      { header: "Name", key: "name" },
      { header: "Phone", key: "phone" },
      { header: "Property", key: "property" },
      { header: "Room", key: "room" },
      { header: "Bed", key: "bed" },
      { header: "Rent", key: "rent", money: true },
      { header: "Check-in", key: "checkIn" },
      { header: "Status", key: "status" },
      { header: "Balance due", key: "balance", money: true },
    ],
    rows: rows.map((t) => ({ name: t.name, phone: t.phone, property: t.propertyName, room: t.room, bed: t.bed, rent: t.rentPaise, checkIn: t.checkIn, status: t.status, balance: t.balancePaise })),
  };
}

export async function ledgerSheet(tx: Queryable, orgId: string, tenancyId: string): Promise<Sheet | null> {
  const t = await tenantDetail(tx, orgId, tenancyId);
  if (!t) return null;
  return {
    name: `Ledger ${t.name}`.slice(0, 31),
    columns: [
      { header: "Date", key: "date" },
      { header: "Type", key: "type" },
      { header: "Note", key: "note" },
      { header: "Amount", key: "amount", money: true },
      { header: "Balance", key: "balance", money: true },
    ],
    rows: [...t.ledger].reverse().map((e) => ({ date: e.createdAt.toISOString().slice(0, 10), type: e.type, note: e.note ?? e.refType ?? "", amount: e.amountPaise, balance: e.isDeposit ? null : e.balancePaise })),
  };
}
