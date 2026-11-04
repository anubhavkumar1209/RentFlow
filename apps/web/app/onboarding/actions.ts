"use server";

import { asUser, users } from "@rentflow/db";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, toLocale } from "@/i18n/request";
import { getDeps } from "@/lib/deps";
import { requireSession } from "@/lib/session";

export interface OnboardingState {
  error: string | null;
  /** Echoed back so the form can refill itself after an error (React resets submitted forms). */
  values: { orgName: string; ownerName: string; language: string };
}

export async function createOrg(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const language = toLocale(String(formData.get("language") ?? ""));
  const values = { orgName, ownerName, language };
  if (!ownerName) return { error: "Enter your name.", values };
  if (!orgName) return { error: "Enter your business name.", values };

  const session = await requireSession();
  const deps = await getDeps();
  try {
    // The create_owner_org database function, run as the user (same as Supabase's RPC).
    await asUser(deps.db, { id: session.userId, phone: session.phone.slice(1) }, (tx) =>
      tx.execute(sql`select public.create_owner_org(${orgName}, ${ownerName})`),
    );
  } catch (err) {
    const e = (err as { cause?: { code?: string; message?: string } }).cause ?? (err as { code?: string; message?: string });
    // "Already own an organisation" means a double-submit already succeeded; carry on.
    if (e.code !== "23505") return { error: e.message ?? "Something went wrong.", values };
  }
  await deps.db.update(users).set({ language }).where(eq(users.id, session.userId));
  (await cookies()).set(LOCALE_COOKIE, language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/dashboard");
}
