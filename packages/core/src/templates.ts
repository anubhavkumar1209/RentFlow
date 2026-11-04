/**
 * Business-initiated WhatsApp templates (CLAUDE.md G1). These must be created
 * and approved in Meta Business Manager with exactly these names, bodies and
 * buttons, in every language WhatsApp supports (languages.ts); the migrations
 * seed them into `message_templates` too. The text lives in ./i18n.
 * {{1}} is always the PG name, so tenants on the shared number know who wrote.
 */
import type { BotLanguage } from "./bot-text";
import { PACKS } from "./i18n";
import { LANGUAGE_CODES, LANGUAGES, type Language } from "./languages";

export type TemplateName =
  | "rf_welcome"
  | "rf_bill"
  | "rf_reminder"
  | "rf_payment_received"
  | "rf_cash_confirm"
  | "rf_refund_confirm"
  | "rf_claim_unmatched"
  | "rf_staff_alert";

export interface TemplateDef {
  category: "UTILITY";
  variables: number;
  body: Record<BotLanguage, string>;
  /** Quick-reply buttons; the payload id is filled in when sending. */
  buttons: Record<BotLanguage, string[]>;
  /** A link button after the quick replies: opens `<app>/p/<bill token>` (the bill & pay page). */
  url?: Record<BotLanguage, string>;
}

/** The link-button target registered with Meta; `{{1}}` is the bill's public token. */
export const PAY_PAGE_PATH = "/p/";

const VARIABLES: Record<TemplateName, number> = {
  rf_welcome: 4,
  rf_bill: 8,
  rf_reminder: 5,
  rf_payment_received: 5,
  rf_cash_confirm: 4,
  rf_refund_confirm: 4,
  rf_claim_unmatched: 2,
  rf_staff_alert: 2,
};

const byLanguage = <T>(get: (language: Language) => T) => Object.fromEntries(LANGUAGE_CODES.map((l) => [l, get(l)])) as Record<Language, T>;

export const TEMPLATES: Record<TemplateName, TemplateDef> = Object.fromEntries(
  (Object.keys(VARIABLES) as TemplateName[]).map((name) => {
    const hasUrl = PACKS.en.templates[name].url !== undefined;
    const def: TemplateDef = {
      category: "UTILITY",
      variables: VARIABLES[name],
      body: byLanguage((l) => PACKS[l].templates[name].body),
      buttons: byLanguage((l) => PACKS[l].templates[name].buttons),
      ...(hasUrl ? { url: byLanguage((l) => PACKS[l].templates[name].url ?? PACKS.en.templates[name].url!) } : {}),
    };
    return [name, def];
  }),
) as Record<TemplateName, TemplateDef>;

/** The languages each template is submitted to Meta in (Odia and Assamese aren't offered). */
export const WHATSAPP_LANGUAGES = LANGUAGE_CODES.filter((l) => LANGUAGES[l].whatsapp === l);

export function renderTemplate(name: TemplateName, language: BotLanguage, variables: string[]): string {
  const def = TEMPLATES[name];
  if (variables.length !== def.variables) {
    throw new Error(`${name} needs ${def.variables} variables, got ${variables.length}`);
  }
  // WhatsApp rejects empty variables and newlines inside them.
  return def.body[language].replace(/\{\{(\d+)\}\}/g, (_, i: string) => variables[Number(i) - 1] || "-");
}
