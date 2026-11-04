"use server";

import { ForbiddenError, importTenants, UserError } from "@rentflow/server";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { getDeps } from "@/lib/deps";
import { requireActor } from "@/lib/session";

export interface ImportState {
  error?: string;
  errors?: { row: number; message: string }[];
  preview?: { row: number; name: string; phone: string; bed: string }[];
  imported?: number;
  /** The parsed rows, carried to the confirm step so the file isn't uploaded twice. */
  rowsJson?: string;
  propertyId?: string;
  depositReceived?: boolean;
}

async function readRows(file: File): Promise<Record<string, string>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const header: string[] = [];
    ws.getRow(1).eachCell((cell, col) => (header[col] = String(cell.text ?? "").trim()));
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const obj: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const key = header[col];
        if (!key) return;
        // Dates come through as Date objects; turn them into YYYY-MM-DD.
        obj[key] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : String(cell.text ?? "").trim();
      });
      rows.push(obj);
    });
    return rows;
  }
  if (name.endsWith(".csv") || file.type.includes("csv") || file.type === "text/plain") {
    const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true });
    return parsed.data;
  }
  throw new UserError("Upload a .csv or .xlsx file (old .xls files: open in Excel and 'Save as' .xlsx).");
}

export async function importAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  try {
    const actor = await requireActor();
    const deps = await getDeps();
    const propertyId = String(form.get("propertyId") ?? "");
    const confirm = form.get("confirm") === "1";
    let rows: Record<string, string>[];
    if (confirm) {
      rows = JSON.parse(String(form.get("rowsJson") ?? "[]")) as Record<string, string>[];
    } else {
      const file = form.get("file");
      if (!file || typeof file === "string" || file.size === 0) return { error: "Choose a file to upload." };
      if (file.size > 2 * 1024 * 1024) return { error: "That file is too big (max 2 MB)." };
      rows = await readRows(file);
    }
    if (rows.length > 500) return { error: "Import at most 500 tenants at a time." };
    const result = await importTenants(deps, actor, propertyId, rows, { depositReceived: form.get("depositReceived") === "on", dryRun: !confirm });
    if (confirm && result.imported > 0) revalidatePath("/", "layout");
    return { errors: result.errors, preview: result.preview, imported: result.imported, rowsJson: JSON.stringify(rows), propertyId, depositReceived: form.get("depositReceived") === "on" };
  } catch (err) {
    if (err instanceof UserError || err instanceof ForbiddenError) return { error: err.message };
    console.error(err);
    return { error: "Couldn't read that file." };
  }
}
