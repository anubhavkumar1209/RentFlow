/**
 * Everything a tenant reads, for one language: the bot, the Meta-approved
 * WhatsApp templates, reminder wording, default notes and the pay page.
 * TypeScript makes every language fill in every line.
 */
import type { AutomationKey } from "../automation";
import type { PayStatusKey } from "./status";

/** Must match CORE_ACTIONS in menu.ts. */
export type MenuAction = "view_bill" | "pay_now" | "send_screenshot" | "my_receipts" | "talk_to_manager";

export interface BotStrings {
  menu: Record<MenuAction, { title: string; description: string }>;
  menuBody: string;
  menuButton: string;
  menuSectionPayments: string;
  menuSectionServices: string;
  moreServices: string;
  notRegistered: string;
  chooseTenancy: string;
  didntUnderstand: string;
  talkToManagerButton: string;
  menuShortButton: string;
  payNowButton: string;
  viewDetailsButton: string;
  noBill: string;
  nothingToPay: string;
  billHeading: (period: string) => string;
  totalLabel: string;
  payLabel: string;
  dueLabel: string;
  paidLabel: string;
  payInstructions: (amount: string) => string;
  askScreenshot: string;
  screenshotReceived: string;
  screenshotDuplicate: string;
  utrSaved: string;
  noReceipts: string;
  receiptsIntro: (count: number) => string;
  managerContact: (name: string, phone: string) => string;
  managerUnavailable: string;
  cashThanks: string;
  cashDisputed: string;
  refundThanks: string;
  refundDisputed: string;
  alreadyAnswered: string;
}

/** Template text in one language. Placeholders {{1}}… must match the English template. */
export interface TemplateText {
  body: string;
  /** Quick-reply button labels, ≤ 20 characters each (WhatsApp limit). */
  buttons: string[];
  /** Link-button label, for templates that have one. */
  url?: string;
}

export type TemplateTexts = Record<
  "rf_welcome" | "rf_bill" | "rf_reminder" | "rf_payment_received" | "rf_cash_confirm" | "rf_refund_confirm" | "rf_claim_unmatched" | "rf_staff_alert",
  TemplateText
>;

export interface PayPageText {
  hi: (name: string) => string;
  bill: (period: string, room: string) => string;
  toPay: string;
  left: string;
  due: (date: string) => string;
  status: Record<PayStatusKey, string>;
  payApp: string;
  payWith: string;
  appHint: string;
  scan: string;
  manual: string;
  upiId: string;
  payee: string;
  upiNumber: string;
  copy: string;
  copied: string;
  exact: (amount: string) => string;
  warn: (payee: string) => string;
  details: string;
  total: string;
  paidTitle: string;
  paidText: string;
  receipt: string;
  confirmingText: string;
  partialText: string;
  noUpi: string;
  invalid: string;
  invalidText: string;
  upload: {
    title: string;
    hint: string;
    choose: string;
    send: string;
    sending: string;
    saved: string;
    duplicate: string;
    invalid: string;
    missing: string;
    tooBig: string;
    error: string;
  };
}

/** The WhatsApp side (bot, templates, reminders). Odia and Assamese reuse Hindi's (see languages.ts). */
export interface WhatsAppText {
  bot: BotStrings;
  templates: TemplateTexts;
  /** "Pay ONLY to this QR…" */
  payOnly: string;
  /** Default owner's note per automation. */
  notes: Record<AutomationKey, string>;
  /** The payment-details line on the bill, and the pay-page link in the bot's "Pay now" reply. */
  pay: { upiId: string; name: string; upiNumber: string; notSetUp: string; pageLink: (url: string) => string };
  /** The {{4}} of the reminder: when the rent is due. */
  due: { before: (date: string) => string; today: string; overdue: (date: string) => string };
  /** Extra words tenants may type for each menu action, in this language. */
  keywords: Partial<Record<MenuAction | "menu", string[]>>;
}

export interface LanguagePack extends WhatsAppText {
  payPage: PayPageText;
}
