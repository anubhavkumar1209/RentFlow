/**
 * The languages RentFlow speaks: English plus the 12 most widely spoken Indian
 * languages (founder's choice, 2026-11-04). Codes are ISO 639-1, as Meta uses them.
 * Everything a person reads (app, WhatsApp, pay page) follows their language.
 */

export const LANGUAGE_CODES = ["en", "hi", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "or", "ur", "as"] as const;
export type Language = (typeof LANGUAGE_CODES)[number];

export interface LanguageInfo {
  code: Language;
  /** Name in English, for the owner's tenant forms and reports. */
  english: string;
  /** Name in the language itself, for language pickers. */
  native: string;
  dir: "ltr" | "rtl";
  /**
   * The language WhatsApp messages go out in. Meta's template languages include
   * every one here except Odia and Assamese, whose speakers get Hindi on WhatsApp
   * (their pay page and app stay in their own language).
   */
  whatsapp: Language;
  /** Draft translation not yet checked by a native speaker (founder: review before launch). */
  needsReview: boolean;
}

export const LANGUAGES: Record<Language, LanguageInfo> = {
  en: { code: "en", english: "English", native: "English", dir: "ltr", whatsapp: "en", needsReview: false },
  hi: { code: "hi", english: "Hindi", native: "हिन्दी", dir: "ltr", whatsapp: "hi", needsReview: false },
  bn: { code: "bn", english: "Bengali", native: "বাংলা", dir: "ltr", whatsapp: "bn", needsReview: true },
  mr: { code: "mr", english: "Marathi", native: "मराठी", dir: "ltr", whatsapp: "mr", needsReview: true },
  te: { code: "te", english: "Telugu", native: "తెలుగు", dir: "ltr", whatsapp: "te", needsReview: true },
  ta: { code: "ta", english: "Tamil", native: "தமிழ்", dir: "ltr", whatsapp: "ta", needsReview: true },
  gu: { code: "gu", english: "Gujarati", native: "ગુજરાતી", dir: "ltr", whatsapp: "gu", needsReview: true },
  kn: { code: "kn", english: "Kannada", native: "ಕನ್ನಡ", dir: "ltr", whatsapp: "kn", needsReview: true },
  ml: { code: "ml", english: "Malayalam", native: "മലയാളം", dir: "ltr", whatsapp: "ml", needsReview: true },
  pa: { code: "pa", english: "Punjabi", native: "ਪੰਜਾਬੀ", dir: "ltr", whatsapp: "pa", needsReview: true },
  or: { code: "or", english: "Odia", native: "ଓଡ଼ିଆ", dir: "ltr", whatsapp: "hi", needsReview: true },
  ur: { code: "ur", english: "Urdu", native: "اردو", dir: "rtl", whatsapp: "ur", needsReview: true },
  as: { code: "as", english: "Assamese", native: "অসমীয়া", dir: "ltr", whatsapp: "hi", needsReview: true },
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Any stored or typed value → a supported language ("Hindi", "हिन्दी", "HI", "te" …); English when unknown. */
export function toLanguage(value: string | null | undefined): Language {
  const v = (value ?? "").trim().toLowerCase();
  if (isLanguage(v)) return v;
  const match = Object.values(LANGUAGES).find((l) => l.english.toLowerCase() === v || l.native.toLowerCase() === v || (v.length >= 3 && l.english.toLowerCase().startsWith(v)));
  return match?.code ?? "en";
}

/** The language a tenant's WhatsApp messages are written in (see `whatsapp` above). */
export function messagingLanguage(language: Language): Language {
  return LANGUAGES[language].whatsapp;
}
