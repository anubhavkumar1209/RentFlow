"use server";

import { users } from "@rentflow/db";
import { UserError } from "@rentflow/server";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, toLocale } from "@/i18n/request";
import { action, str } from "@/lib/actions";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Saves the person's own name, email and language. Phone is the login identity and isn't editable. */
export const saveMyProfileAction = action(async ({ actor, deps, form }) => {
  const language = toLocale(str(form, "language"));
  const t = await getTranslations({ locale: language, namespace: "profile" });
  const name = str(form, "name");
  const email = str(form, "email").toLowerCase();
  if (!name) throw new UserError(t("nameRequired"));
  if (email && !EMAIL.test(email)) throw new UserError(t("invalidEmail"));
  await deps.db.update(users).set({ name, email: email || null, language }).where(eq(users.id, actor.userId));
  (await cookies()).set(LOCALE_COOKIE, language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return t("saved");
});
