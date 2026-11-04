/** One pack per language (see types.ts). Add a language: a pack here + an entry in languages.ts. */
import type { Language } from "../languages";
import { as } from "./as";
import { bn } from "./bn";
import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";
import { kn } from "./kn";
import { ml } from "./ml";
import { mr } from "./mr";
import { or } from "./or";
import { pa } from "./pa";
import { ta } from "./ta";
import { te } from "./te";
import type { LanguagePack } from "./types";
import { ur } from "./ur";

export const PACKS: Record<Language, LanguagePack> = { en, hi, bn, mr, te, ta, gu, kn, ml, pa, or, ur, as };

export function pack(language: Language): LanguagePack {
  return PACKS[language] ?? en;
}

export type { BotStrings, LanguagePack, MenuAction, PayPageText, TemplateText } from "./types";
export type { PayStatusKey } from "./status";
