"use server";

import { users } from "@rentflow/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, toLocale } from "@/i18n/request";
import { getDeps } from "@/lib/deps";
import { PROPERTY_COOKIE } from "@/lib/property";
import { isLoggedIn, requireSession } from "@/lib/session";

const YEAR = 60 * 60 * 24 * 365;

/** Property switcher: "all" or a property id (validated when read, see lib/property.ts). */
export async function setPropertyAction(propertyId: string): Promise<void> {
  await requireSession();
  const jar = await cookies();
  if (propertyId === "all") jar.delete(PROPERTY_COOKIE);
  else jar.set(PROPERTY_COOKIE, propertyId, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** Language switch: always remembered in a cookie (works on the public pages too), and on the account when logged in. */
export async function setLanguageAction(language: string): Promise<void> {
  const locale = toLocale(language);
  if (await isLoggedIn()) {
    const session = await requireSession();
    const deps = await getDeps();
    await deps.db.update(users).set({ language: locale }).where(eq(users.id, session.userId));
  }
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}
