/** Every word the bot says, in each tenant's language (CLAUDE.md G1). The text lives in ./i18n. */
import { pack, PACKS } from "./i18n";
import type { BotStrings } from "./i18n";
import { LANGUAGE_CODES, type Language } from "./languages";

/** Any language RentFlow speaks; Odia and Assamese use Hindi on WhatsApp (see languages.ts). */
export type BotLanguage = Language;

export const PAY_ONLY_WARNING = Object.fromEntries(LANGUAGE_CODES.map((l) => [l, PACKS[l].payOnly])) as Record<Language, string>;

export function botText(language: BotLanguage): BotStrings {
  return pack(language).bot;
}
