import type { AppDeps } from "@rentflow/server";
import { isDemo } from "./env";

const cache = globalThis as typeof globalThis & { __rentflowDeps?: Promise<AppDeps> };

/**
 * Server-side services for this process. Demo mode: local database and adapters.
 * Production: Supabase Postgres (DATABASE_URL), Supabase Storage, pg-boss for jobs
 * (the workers and WhatsApp webhook run in apps/api).
 */
export function getDeps(): Promise<AppDeps> {
  cache.__rentflowDeps ??= isDemo
    ? import("./demo/server").then((m) => m.demoDeps())
    : import("@rentflow/server/production").then((m) => m.createProductionDeps());
  return cache.__rentflowDeps;
}
