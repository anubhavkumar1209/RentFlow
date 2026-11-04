/**
 * Database access. One Drizzle API over two drivers:
 *   - postgres-js → Supabase in production (DATABASE_URL)
 *   - PGlite      → the in-process database used by tests and demo mode (see local.ts)
 *
 * Two ways to run queries:
 *   asUser(db, user, fn)  — as the logged-in user, under RLS, exactly like Supabase's API.
 *   db directly            — as the database owner (server-side writes after an explicit permission check).
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything queries can run on: the database or an open transaction. */
export type Queryable = Db | Tx;

export interface DbUser {
  id: string;
  /** As in the Supabase JWT: digits only, no "+". */
  phone: string;
}

export function connectPostgres(url: string, options: { max?: number } = {}): Db {
  // prepare: false keeps it compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: options.max ?? 5 });
  return drizzlePostgres(client, { schema }) as unknown as Db;
}

/** Runs `fn` in a transaction as `user`, with RLS applied (Supabase's `authenticated` role). */
export async function asUser<T>(db: Db, user: DbUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: user.id, phone: user.phone, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** Normalises the result of `execute` across drivers (postgres-js returns an array, PGlite `{ rows }`). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export { schema };
