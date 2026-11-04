/**
 * Server-side half of demo mode: a local Postgres (PGlite) with the real
 * migrations and RLS, local files, WhatsApp messages kept in message_log for the
 * phone simulator, and a cookie standing in for the Supabase session. The cookie
 * is unsigned, which is fine only because demo mode refuses to run outside development.
 */
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { drizzleLocal, openLocalDb, type JwtUser } from "@rentflow/db/local";
import type { AppDeps } from "@rentflow/server";
import { createDemoDeps, demoUserId } from "@rentflow/server/demo";
import { cookies } from "next/headers";
import { isDemo } from "../env";
import { DEMO_COOKIE } from "./constants";

/** Kept outside the project folder so OneDrive doesn't try to sync a live database. */
export const DEMO_DATA_DIR = path.join(os.tmpdir(), "rentflow-demo-db");
export const DEMO_FILES_DIR = path.join(os.tmpdir(), "rentflow-demo-files");

const cache = globalThis as typeof globalThis & { __rentflowDemoDb?: Promise<PGlite>; __rentflowDemoDeps?: Promise<AppDeps> };

function assertDemo() {
  if (!isDemo || process.env.NODE_ENV === "production") {
    throw new Error("Demo mode is only available in local development.");
  }
}

export function demoDb(): Promise<PGlite> {
  assertDemo();
  cache.__rentflowDemoDb ??= openLocalDb({
    dataDir: DEMO_DATA_DIR,
    migrationsFolder: path.resolve(process.cwd(), "../../packages/db/migrations"),
  });
  return cache.__rentflowDemoDb;
}

export function demoDeps(): Promise<AppDeps> {
  assertDemo();
  cache.__rentflowDemoDeps ??= demoDb().then((client) =>
    createDemoDeps({ db: drizzleLocal(client), filesDir: DEMO_FILES_DIR, jobs: "background", config: { appUrl: "http://localhost:3000" } }),
  );
  return cache.__rentflowDemoDeps;
}

export async function startDemoSession(e164: string): Promise<void> {
  assertDemo();
  const user: JwtUser = { id: demoUserId(e164), phone: e164.slice(1) };
  (await cookies()).set(DEMO_COOKIE, JSON.stringify(user), { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function readDemoSession(): Promise<JwtUser | null> {
  assertDemo();
  const raw = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<JwtUser>;
    return typeof parsed.id === "string" && typeof parsed.phone === "string" ? { id: parsed.id, phone: parsed.phone } : null;
  } catch {
    return null;
  }
}

export async function endDemoSession(): Promise<void> {
  (await cookies()).delete(DEMO_COOKIE);
}
