/**
 * Test helpers on top of src/local.ts: a fresh in-memory database per suite and
 * shortcuts for running queries as a specific Supabase user.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, openLocalDb, type JwtUser } from "../src/local";

export type TestUser = JwtUser;
export const as = asUser;

export async function createTestDb(): Promise<PGlite> {
  return openLocalDb({ migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
}

let phoneCounter = 0;
export function newUser(): TestUser {
  phoneCounter += 1;
  return { id: randomUUID(), phone: `9198765${String(phoneCounter).padStart(5, "0")}` };
}

/** Convenience: run a query as `user` and return its rows. */
export async function rowsAs<R = Record<string, unknown>>(
  db: PGlite,
  user: TestUser | null,
  query: string,
  params: unknown[] = [],
): Promise<R[]> {
  return asUser(db, user, async (tx) => (await tx.query<R>(query, params)).rows);
}
