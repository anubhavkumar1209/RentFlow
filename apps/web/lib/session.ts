import { asUser, type Tx } from "@rentflow/db";
import { loadActor, type Actor } from "@rentflow/server";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDeps } from "./deps";
import { isDemo } from "./env";
import { createClient } from "./supabase/server";

export interface Session {
  userId: string;
  /** E.164, e.g. +919876543210 */
  phone: string;
  /** Null until the user has created (owner) or been added to (manager) an org. */
  actor: Actor | null;
}

/** Who is logged in: Supabase Auth in production, a cookie in demo mode. */
async function identity(): Promise<{ id: string; phone: string } | null> {
  if (isDemo) {
    const { readDemoSession } = await import("./demo/server");
    return readDemoSession();
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const phone = typeof claims.phone === "string" ? claims.phone.replace(/^\+/, "") : "";
  return { id: claims.sub, phone };
}

/** True if someone is logged in (no redirect), e.g. to skip the public landing page. */
export async function isLoggedIn(): Promise<boolean> {
  return (await identity()) !== null;
}

/** The logged-in user and their org membership. Redirects to /login if there is no session. */
export const requireSession = cache(async (): Promise<Session> => {
  const who = await identity();
  if (!who) redirect("/login");
  const deps = await getDeps();
  // TODO(phase-4): org switcher for people who belong to more than one org.
  const actor = await loadActor(deps.db, who.id);
  return { userId: who.id, phone: `+${who.phone}`, actor };
});

/** Like requireSession, but the user must belong to an org. */
export async function requireActor(): Promise<Actor> {
  const session = await requireSession();
  if (!session.actor) redirect("/onboarding");
  return session.actor;
}

/** Owner-only pages: managers are sent back to their home page. */
export async function requireOwnerActor(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== "owner") redirect("/dashboard");
  return actor;
}

/** Pages for one property: a 404 for anyone without access (no hint that it exists). */
export function ensureAccess(allowed: boolean): void {
  if (!allowed) notFound();
}

/** Runs read queries as the logged-in user, under RLS. */
export async function asCurrentUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const session = await requireSession();
  const deps = await getDeps();
  return asUser(deps.db, { id: session.userId, phone: session.phone.slice(1) }, fn);
}
