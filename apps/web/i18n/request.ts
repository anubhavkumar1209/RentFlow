import { LANGUAGE_CODES, toLanguage, type Language } from "@rentflow/core";
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = LANGUAGE_CODES;
export type Locale = Language;
/** Set when the user picks a language (onboarding, settings, login page switch). */
export const LOCALE_COOKIE = "rf_lang";

export function toLocale(value: string | undefined | null): Locale {
  return toLanguage(value);
}

type Messages = { [key: string]: string | Messages };

/** English underneath, the chosen language on top: a line not yet translated shows in English, never as a key. */
function merge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === "object" && typeof b === "object" ? merge(b, v) : v;
  }
  return out;
}

// No locale in the URL: the app is for logged-in staff, so the language is a personal setting.
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const en = (await import("../messages/en.json")).default as Messages;
  const messages = locale === "en" ? en : merge(en, (await import(`../messages/${locale}.json`)).default as Messages);
  return { locale, messages };
});
