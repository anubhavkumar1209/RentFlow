/**
 * Bank credit-alert email parsers (CLAUDE.md §8). One small pure function per
 * bank; each returns null if the email isn't a credit alert it understands, and
 * unknown emails go to the owner's "unparsed" queue.
 *
 * The fixtures in ./fixtures.ts are modelled on public examples of each bank's
 * alerts. Banks change wording often: add a fixture from a real (redacted)
 * email whenever a parser misses one.
 */
import { parseRupeesToPaise, type Paise } from "../money";
import { isISODate, type ISODate } from "../dates";

export interface InboundEmail {
  from: string;
  subject: string;
  text: string;
}

export interface ParsedCredit {
  bank: BankCode;
  amountPaise: Paise;
  utr: string | null;
  payerName: string | null;
  payerVpa: string | null;
  creditedOn: ISODate | null;
}

export type BankCode = "hdfc" | "icici" | "sbi" | "axis" | "kotak" | "pnb";

interface BankParser {
  bank: BankCode;
  /** Sender domains the bank sends alerts from. */
  senders: RegExp;
  parse(text: string, subject: string): Omit<ParsedCredit, "bank"> | null;
}

const AMOUNT = String.raw`(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d{1,2})?)`;
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parses "02-11-26", "02/11/2026", "02-Nov-26", "02 Nov 2026", "2026-11-02". */
export function parseBankDate(raw: string | undefined): ISODate | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return check(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]+(\d{2,4})/.exec(s);
  if (m) {
    const month = MONTHS[(m[2] ?? "").toLowerCase()];
    return month ? check(`${year(m[3])}-${month}-${pad(m[1])}`) : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return check(`${year(m[3])}-${pad(m[2])}-${pad(m[1])}`);
  return null;

  function pad(v: string | undefined) {
    return (v ?? "").padStart(2, "0");
  }
  function year(v: string | undefined) {
    return v && v.length === 2 ? `20${v}` : (v ?? "");
  }
  function check(d: string) {
    return isISODate(d) ? d : null;
  }
}

function amount(text: string, pattern: RegExp): Paise | null {
  const m = pattern.exec(text);
  return m?.[1] ? parseRupeesToPaise(m[1]) : null;
}

function first(text: string, pattern: RegExp): string | null {
  const m = pattern.exec(text);
  return m?.[1]?.trim() || null;
}

const VPA = /([a-zA-Z0-9._-]{2,}@[a-zA-Z][a-zA-Z0-9.-]+)/;

const PARSERS: BankParser[] = [
  {
    // "Rs.2866.42 has been credited to your account **1234 by VPA anubhav@okaxis ANUBHAV KUMAR on 02-11-26. Your UPI transaction reference number is 630612345678."
    bank: "hdfc",
    senders: /hdfcbank\.(net|com)/i,
    parse(text) {
      const amountPaise = amount(text, new RegExp(`${AMOUNT}\\s+(?:has been|is successfully)\\s+credited`, "i"));
      if (amountPaise === null) return null;
      const by = /by VPA\s+(\S+)\s+(.+?)\s+on\s+(\S+)/i.exec(text);
      return {
        amountPaise,
        utr: first(text, /reference number is\s*(\d{10,})/i),
        payerVpa: by?.[1] ?? null,
        payerName: by?.[2]?.trim() ?? null,
        creditedOn: parseBankDate(by?.[3]),
      };
    },
  },
  {
    // "Your account XX123 has been credited with INR 2,866.42 on 02-Nov-26. Info: UPI/630612345678/ANUBHAV KUMAR/anubhav@okaxis."
    bank: "icici",
    senders: /icicibank\.com/i,
    parse(text) {
      const amountPaise = amount(text, new RegExp(`credited with\\s+${AMOUNT}`, "i"));
      if (amountPaise === null) return null;
      const info = /UPI\/(\d{10,})\/([^/]+)\/([^/.\s]+@[^/\s]+?)\.?(?:\s|$)/i.exec(text);
      return {
        amountPaise,
        utr: info?.[1] ?? first(text, /UPI\/(\d{10,})/i),
        payerName: info?.[2]?.trim() ?? null,
        payerVpa: info?.[3] ?? null,
        creditedOn: parseBankDate(first(text, /\bon\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i) ?? undefined),
      };
    },
  },
  {
    // "Dear Customer, your A/c X1234 has been credited by Rs.2866.42 on 02Nov26 transfer from ANUBHAV KUMAR Ref No 630612345678 -SBI"
    bank: "sbi",
    senders: /(sbi\.co\.in|onlinesbi)/i,
    parse(text) {
      const amountPaise = amount(text, new RegExp(`credited by\\s+${AMOUNT}`, "i"));
      if (amountPaise === null) return null;
      const on = /on\s+(\d{1,2})([A-Za-z]{3})(\d{2,4})/i.exec(text);
      return {
        amountPaise,
        utr: first(text, /Ref(?:erence)? No\.?\s*(\d{10,})/i),
        payerName: first(text, /transfer from\s+(.+?)\s+Ref/i),
        payerVpa: first(text, VPA),
        creditedOn: on ? parseBankDate(`${on[1]}-${on[2]}-${on[3]}`) : null,
      };
    },
  },
  {
    // "INR 2866.42 credited to A/c no. XX1234 on 02-11-2026 at 10:15:01 IST. Info- UPI/P2A/630612345678/ANUBHAV KUMAR/anubhav@okaxis"
    bank: "axis",
    senders: /axisbank\.com/i,
    parse(text) {
      const amountPaise = amount(text, new RegExp(`${AMOUNT}\\s+credited to`, "i"));
      if (amountPaise === null) return null;
      const info = /UPI\/[A-Z0-9]+\/(\d{10,})\/([^/]+)\/(\S+@\S+?)(?:\.|\s|$)/i.exec(text);
      return {
        amountPaise,
        utr: info?.[1] ?? first(text, /UPI\/\w+\/(\d{10,})/i),
        payerName: info?.[2]?.trim() ?? null,
        payerVpa: info?.[3] ?? null,
        creditedOn: parseBankDate(first(text, /\bon\s+(\d{2}-\d{2}-\d{4})/i) ?? undefined),
      };
    },
  },
  {
    // "Rs.2866.42 is credited to your Kotak Bank a/c XX1234 by anubhav@okaxis on 02/11/26. UPI Ref: 630612345678."
    bank: "kotak",
    senders: /kotak\.com/i,
    parse(text) {
      const amountPaise = amount(text, new RegExp(`${AMOUNT}\\s+is credited to`, "i"));
      if (amountPaise === null) return null;
      return {
        amountPaise,
        utr: first(text, /UPI Ref(?:erence)?(?: No)?[:.]?\s*(\d{10,})/i),
        payerName: null,
        payerVpa: first(text, /by\s+([a-zA-Z0-9._-]+@[a-zA-Z][a-zA-Z0-9.-]+?)\s+on/i),
        creditedOn: parseBankDate(first(text, /\bon\s+(\d{2}\/\d{2}\/\d{2,4})/i) ?? undefined),
      };
    },
  },
  {
    // "Your A/c XX1234 is credited with INR 2,866.42 on 02-11-2026 by UPI ref no 630612345678 from ANUBHAV KUMAR. -PNB"
    bank: "pnb",
    senders: /pnb\.(co\.in|bank\.in)/i,
    parse(text) {
      const amountPaise = amount(text, new RegExp(`is credited with\\s+${AMOUNT}`, "i"));
      if (amountPaise === null) return null;
      return {
        amountPaise,
        utr: first(text, /ref no\.?\s*(\d{10,})/i),
        payerName: first(text, /from\s+(.+?)[.\s]*(?:-PNB|$)/i),
        payerVpa: first(text, VPA),
        creditedOn: parseBankDate(first(text, /\bon\s+(\d{2}-\d{2}-\d{4})/i) ?? undefined),
      };
    },
  },
];

export const SUPPORTED_BANKS: BankCode[] = PARSERS.map((p) => p.bank);

/** True if `from` is one of the bank's own sending addresses (used with a DKIM check before auto-settling). */
export function isFromBank(bank: BankCode, from: string): boolean {
  const domain = /@([^>\s]+)>?\s*$/.exec(from.trim())?.[1] ?? "";
  return PARSERS.some((p) => p.bank === bank && p.senders.test(domain));
}

/** Strips forwarding noise ("---------- Forwarded message ---------", quoted ">" lines, extra spaces). */
function clean(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^>+\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the parsed credit, or null if this isn't a credit alert we understand. */
export function parseBankEmail(email: InboundEmail): ParsedCredit | null {
  const text = clean(email.text);
  // Debit alerts often mention "credited" too ("…credited to beneficiary"); skip them.
  if (/\bdebited\b/i.test(text) && !/\bcredited\b/i.test(text.split(/debited/i)[0] ?? "")) return null;
  const haystack = `${email.from} ${text}`;
  const ordered = [...PARSERS].sort((a, b) => Number(b.senders.test(haystack)) - Number(a.senders.test(haystack)));
  for (const parser of ordered) {
    const result = parser.parse(text, email.subject);
    if (result && result.amountPaise > 0) return { bank: parser.bank, ...result };
  }
  return null;
}
