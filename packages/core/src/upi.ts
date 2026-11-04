import { periodShortCode, type Period } from "./dates";
import { pack } from "./i18n";
import type { Language } from "./languages";
import { assertPaise, type Paise } from "./money";

/** 286642 → "2866.42" (UPI wants rupees with exactly two decimals). */
export function paiseToUpiAmount(paise: Paise): string {
  assertPaise(paise);
  return `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/** "RF-303A-NOV": the note the tenant's UPI app shows, and that some banks echo back. */
export function upiNote(roomNumber: string, bedLabel: string, period: Period): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `RF-${clean(roomNumber)}${clean(bedLabel)}-${periodShortCode(period)}`;
}

export interface UpiPayInput {
  vpa: string;
  payeeName: string;
  amountPaise: Paise;
  note: string;
}

function upiQuery(input: UpiPayInput): string {
  const params = [
    ["pa", input.vpa],
    ["pn", input.payeeName],
    ["am", paiseToUpiAmount(input.amountPaise)],
    ["tn", input.note],
    ["cu", "INR"],
  ];
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v ?? "")}`).join("&");
}

/** upi://pay?pa=…&pn=…&am=…&tn=…&cu=INR (CLAUDE.md F2). On Android this opens the "choose an app" sheet. */
export function upiPayLink(input: UpiPayInput): string {
  return `upi://pay?${upiQuery(input)}`;
}

/**
 * The same payment opened directly in a specific app (for iPhones, where
 * upi:// has no app chooser). Amount and payee are pre-filled where the app supports it.
 */
export function upiAppLinks(input: UpiPayInput): { app: "phonepe" | "gpay" | "paytm"; label: string; href: string }[] {
  const q = upiQuery(input);
  return [
    { app: "phonepe", label: "PhonePe", href: `phonepe://pay?${q}` },
    { app: "gpay", label: "Google Pay", href: `tez://upi/pay?${q}` },
    { app: "paytm", label: "Paytm", href: `paytmmp://pay?${q}` },
  ];
}

/** "+919876543210" / "9876543210" → "98765 43210"; null if it isn't a 10-digit Indian mobile. */
export function formatUpiPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `${digits.slice(0, 5)} ${digits.slice(5)}` : null;
}

/** One line for the WhatsApp bill: where to pay, so tenants can pay by hand if the QR or link doesn't work. */
export function paymentDetailsLine(input: { vpa: string | null; payeeName: string; upiPhone: string | null }, language: Language): string {
  const t = pack(language).pay;
  const phone = formatUpiPhone(input.upiPhone);
  if (!input.vpa) return t.notSetUp;
  return [`${t.upiId}: ${input.vpa}`, `${t.name}: ${input.payeeName}`, ...(phone ? [`${t.upiNumber}: ${phone}`] : [])].join(" · ");
}
