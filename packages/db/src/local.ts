/**
 * A local Postgres (PGlite, in-process) with the real migrations applied, plus
 * stand-ins for the pieces Supabase normally provides: the anon/authenticated/
 * service_role roles and auth.uid()/auth.jwt().
 *
 * Used by the RLS tests and by the web app's demo mode. Never used in production.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
`;

export interface LocalDbOptions {
  /** Folder to keep the data in between restarts. Omit for an in-memory database. */
  dataDir?: string;
  /** Absolute path to packages/db/migrations. */
  migrationsFolder: string;
}

/** Drizzle on top of a local PGlite database, with the same API as connectPostgres(). */
export function drizzleLocal(client: PGlite): Db {
  return drizzle(client, { schema }) as unknown as Db;
}

export async function openLocalDb({ dataDir, migrationsFolder }: LocalDbOptions): Promise<PGlite> {
  const client = new PGlite(dataDir);
  const { rows } = await client.query("select 1 from pg_namespace where nspname = 'auth'");
  if (rows.length === 0) await client.exec(SUPABASE_STUBS);
  await migrate(drizzle(client), { migrationsFolder });
  return client;
}

export interface JwtUser {
  id: string;
  /** As Supabase puts it in the JWT: digits only, no "+". */
  phone: string;
}

/**
 * Runs `fn` in a transaction as `user` (or as anon when user is null), the same
 * way Supabase's API does: `set local role authenticated` + `request.jwt.claims`.
 * RLS therefore applies exactly as it would in production.
 */
export async function asUser<T>(
  db: PGlite,
  user: JwtUser | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = user ? { sub: user.id, phone: user.phone, role: "authenticated" } : { role: "anon" };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
    return fn(tx);
  });
}
