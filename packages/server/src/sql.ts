import { rowsOf, type Queryable } from "@rentflow/db";
import type { SQL } from "drizzle-orm";

/**
 * Raw-SQL helpers. Drivers disagree on how they return bigint and date columns,
 * so raw queries cast dates to text (`::text`) and money goes through toPaise().
 */
export async function many<T>(db: Queryable, query: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

export async function one<T>(db: Queryable, query: SQL): Promise<T | null> {
  return (await many<T>(db, query))[0] ?? null;
}

/** bigint/numeric/string from the driver → an exact integer number of paise. */
export function toPaise(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "bigint" ? Number(value) : typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isSafeInteger(n)) throw new TypeError(`Not an integer amount: ${String(value)}`);
  return n;
}

/** Drizzle hands raw-query timestamps back as strings (both drivers); turn them into Dates. */
export function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}
