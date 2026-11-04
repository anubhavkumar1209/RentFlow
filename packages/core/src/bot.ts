/**
 * The WhatsApp conversation engine (CLAUDE.md §9): a pure state machine.
 * The caller loads a snapshot of the tenant's data, calls handleBotMessage,
 * sends the replies and applies the effects (DB writes, QR generation, …).
 */
import { botText, type BotLanguage } from "./bot-text";
import { formatDate, formatPeriod, type ISODate, type Period } from "./dates";
import { CORE_ACTIONS, MAX_BUTTONS, truncate, type CoreAction, type WhatsAppMenu } from "./menu";
import { PACKS } from "./i18n";
import { formatINR, type Paise } from "./money";

export type BotState = "idle" | "choose_tenancy" | "awaiting_screenshot" | "awaiting_utr";

export interface BotContext {
  /** What the tenant asked for before we had to ask "which PG?". */
  pendingAction?: CoreAction;
}

export interface BotTenancy {
  tenancyId: string;
  propertyName: string;
  roomNumber: string;
  bedLabel: string;
  tenantName: string;
  language: BotLanguage;
}

export interface BotBill {
  billId: string;
  period: Period;
  dueDate: ISODate;
  totalPaise: Paise;
  payablePaise: Paise;
  outstandingPaise: Paise;
  paid: boolean;
  lines: { description: string; amountPaise: Paise }[];
}

export interface BotSnapshot {
  /** Current (active or on-notice) tenancies registered to the sender's number. */
  tenancies: BotTenancy[];
  /** The tenancy the conversation is about; null until resolved. */
  selected: BotTenancy | null;
  bill: BotBill | null;
  menu: WhatsAppMenu | null;
}

export type BotInput =
  | { kind: "text"; text: string }
  | { kind: "reply"; id: string }
  | { kind: "image" };

export interface Button {
  id: string;
  title: string;
}

export type OutMessage =
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: Button[] }
  | { kind: "list"; menu: WhatsAppMenu };

export type BotEffect =
  | { type: "select_tenancy"; tenancyId: string; then: CoreAction | "menu" }
  | { type: "send_payment" }
  | { type: "save_screenshot" }
  | { type: "set_utr_last4"; last4: string }
  | { type: "send_receipts" }
  | { type: "alert_manager" }
  | { type: "consent" }
  | { type: "cash_response"; entryId: string; correct: boolean }
  | { type: "refund_response"; tenancyId: string; received: boolean };

export interface BotResult {
  replies: OutMessage[];
  effects: BotEffect[];
  state: BotState;
  context: BotContext;
}

const TEXT_SHORTCUTS: [RegExp, CoreAction | "menu"][] = [
  [/^(hi+|hello|hey|menu|start|namaste|namaskar|हाय|नमस्ते|मेनू)$/, "menu"],
  [/\b(bill|बिल)\b/, "view_bill"],
  [/\b(pay|payment|qr|upi|भुगतान)\b/, "pay_now"],
  [/\b(receipts?|रसीद)\b/, "my_receipts"],
  [/\b(screenshot|स्क्रीनशॉट)\b/, "send_screenshot"],
  [/\b(manager|call|help|मैनेजर)\b/, "talk_to_manager"],
];

export function handleBotMessage(state: BotState, context: BotContext, input: BotInput, snap: BotSnapshot): BotResult {
  const lang: BotLanguage = snap.selected?.language ?? snap.tenancies[0]?.language ?? "en";
  const t = botText(lang);
  const result = (replies: OutMessage[], effects: BotEffect[] = [], next: BotState = "idle", ctx: BotContext = {}): BotResult => ({
    replies: replies.map((r) => withHeader(r, snap.selected?.propertyName ?? null)),
    effects,
    state: next,
    context: ctx,
  });

  if (snap.tenancies.length === 0) return result([{ kind: "text", text: t.notRegistered }]);

  // Answers to cash / refund confirmations work whatever the conversation state.
  if (input.kind === "reply") {
    const cash = /^cash:([\w-]+):(yes|no)$/.exec(input.id);
    if (cash?.[1]) return result([], [{ type: "cash_response", entryId: cash[1], correct: cash[2] === "yes" }]);
    const refund = /^refund:([\w-]+):(yes|no)$/.exec(input.id);
    if (refund?.[1]) return result([], [{ type: "refund_response", tenancyId: refund[1], received: refund[2] === "yes" }]);
    const pick = /^tenancy:([\w-]+)$/.exec(input.id);
    if (pick?.[1] && snap.tenancies.some((x) => x.tenancyId === pick[1])) {
      return result([], [{ type: "select_tenancy", tenancyId: pick[1], then: context.pendingAction ?? "menu" }]);
    }
    if (input.id === "consent:yes") return result(snap.menu ? [{ kind: "list", menu: snap.menu }] : [], [{ type: "consent" }]);
  }

  if (input.kind === "image") {
    if (!snap.selected) return askWhich(snap, "send_screenshot", t, result);
    return result([], [{ type: "save_screenshot" }], "awaiting_utr");
  }

  if (state === "awaiting_utr" && input.kind === "text") {
    const digits = input.text.replace(/\D/g, "");
    if (digits.length >= 4 && digits.length <= 22 && /^[\d\s-]+$/.test(input.text.trim())) {
      return result([{ kind: "text", text: t.utrSaved }], [{ type: "set_utr_last4", last4: digits.slice(-4) }]);
    }
  }

  const action = resolveAction(input);
  if (action === null) {
    if (state === "awaiting_screenshot") return result([{ kind: "text", text: t.askScreenshot }], [], "awaiting_screenshot");
    const replies: OutMessage[] = [{ kind: "buttons", text: t.didntUnderstand, buttons: [{ id: "menu:talk_to_manager", title: t.talkToManagerButton }] }];
    if (snap.menu) replies.push({ kind: "list", menu: snap.menu });
    return result(replies);
  }

  if (!snap.selected) {
    if (snap.tenancies.length === 1 && snap.tenancies[0]) {
      return result([], [{ type: "select_tenancy", tenancyId: snap.tenancies[0].tenancyId, then: action }]);
    }
    return askWhich(snap, action === "menu" ? undefined : action, t, result);
  }

  switch (action) {
    case "menu":
      return result(snap.menu ? [{ kind: "list", menu: snap.menu }] : []);
    case "view_bill":
      if (!snap.bill) return result([{ kind: "text", text: t.noBill }]);
      return result([
        snap.bill.paid
          ? { kind: "text", text: billDetails(snap.bill, t) }
          : { kind: "buttons", text: billDetails(snap.bill, t), buttons: [{ id: "menu:pay_now", title: t.payNowButton }, { id: "menu:show", title: t.menuShortButton }] },
      ]);
    case "pay_now":
      if (!snap.bill || snap.bill.paid || snap.bill.outstandingPaise <= 0) return result([{ kind: "text", text: t.nothingToPay }]);
      return result([], [{ type: "send_payment" }]);
    case "send_screenshot":
      return result([{ kind: "text", text: t.askScreenshot }], [], "awaiting_screenshot");
    case "my_receipts":
      return result([], [{ type: "send_receipts" }]);
    case "talk_to_manager":
      return result([], [{ type: "alert_manager" }]);
  }
}

function resolveAction(input: BotInput): CoreAction | "menu" | null {
  if (input.kind === "reply") {
    if (input.id === "menu:show" || input.id === "consent:menu") return "menu";
    const id = input.id.replace(/^menu:/, "");
    return (CORE_ACTIONS as string[]).includes(id) ? (id as CoreAction) : null;
  }
  if (input.kind !== "text") return null;
  const text = input.text.trim().toLowerCase();
  for (const [pattern, action] of TEXT_SHORTCUTS) if (pattern.test(text)) return action;
  // Words in every Indian language we speak. A substring match, because  doesn't work outside ASCII.
  // Any language, not just the tenant's: people often type in a second language.
  for (const [action, words] of NATIVE_KEYWORDS) if (words.some((w) => text === w || text.includes(w))) return action;
  return null;
}

/** "menu" first (exact-ish greetings), then the actions, from every language pack. */
const NATIVE_KEYWORDS: [CoreAction | "menu", string[]][] = (["menu", ...CORE_ACTIONS] as const).map((action) => [
  action,
  [...new Set(Object.values(PACKS).flatMap((p) => p.keywords[action] ?? []))].map((w) => w.toLowerCase()),
]);

function askWhich(
  snap: BotSnapshot,
  pendingAction: CoreAction | undefined,
  t: ReturnType<typeof botText>,
  result: (r: OutMessage[], e?: BotEffect[], s?: BotState, c?: BotContext) => BotResult,
): BotResult {
  const options = snap.tenancies.map((x) => ({ id: `tenancy:${x.tenancyId}`, title: truncate(x.propertyName, 20), description: `Room ${x.roomNumber}${x.bedLabel}` }));
  const reply: OutMessage =
    options.length <= MAX_BUTTONS
      ? { kind: "buttons", text: t.chooseTenancy, buttons: options.map(({ id, title }) => ({ id, title })) }
      : {
          kind: "list",
          menu: {
            header: "RentFlow",
            body: t.chooseTenancy,
            button: t.menuButton,
            sections: [{ title: "PG", rows: options.slice(0, 10).map((o) => ({ ...o, title: truncate(o.title, 24) })) }],
          },
        };
  return result([reply], [], "choose_tenancy", pendingAction ? { pendingAction } : {});
}

export function billDetails(bill: BotBill, t: ReturnType<typeof botText>): string {
  const lines = bill.lines.map((l) => `• ${l.description}: ${formatINR(l.amountPaise)}`);
  return [
    `*${t.billHeading(formatPeriod(bill.period))}*`,
    ...lines,
    "",
    `${t.totalLabel}: ${formatINR(bill.totalPaise)}`,
    bill.paid ? t.paidLabel : `${t.payLabel}: *${formatINR(bill.payablePaise)}*`,
    bill.paid ? "" : `${t.dueLabel}: ${formatDate(bill.dueDate)}`,
  ]
    .filter((l, i, all) => !(l === "" && i === all.length - 1))
    .join("\n");
}

/** Every message names the PG (CLAUDE.md §14). */
function withHeader(message: OutMessage, propertyName: string | null): OutMessage {
  if (!propertyName) return message;
  if (message.kind === "list") return message;
  return { ...message, text: `*${propertyName}*\n${message.text}` };
}
