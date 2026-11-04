/**
 * Money helpers. All money in RentFlow is an integer number of paise
 * (CLAUDE.md §7.1). These helpers never use floating-point arithmetic on
 * amounts: parsing works on the digit string, formatting on integer division.
 */

export type Paise = number;

export function assertPaise(value: number, label = "amount"): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of paise, got ${value}`);
  }
}

/** Groups a string of digits the Indian way: 1,25,000 / 12,34,56,789. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

export interface FormatInrOptions {
  /** Show ".00" even for whole-rupee amounts. Default: only show paise when non-zero. */
  alwaysShowPaise?: boolean;
}

/** 12500037 → "₹1,25,000.37"; 286600 → "₹2,866"; -50000 → "-₹500". */
export function formatINR(paise: Paise, options: FormatInrOptions = {}): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = negative ? -paise : paise;
  const rupees = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const rupeePart = groupIndian(String(rupees));
  const paisePart =
    remainder !== 0 || options.alwaysShowPaise ? `.${String(remainder).padStart(2, "0")}` : "";
  return `${negative ? "-" : ""}₹${rupeePart}${paisePart}`;
}

/**
 * Parses a rupee amount typed by a person ("2,866", "₹1,25,000.37", "500.5")
 * into paise. Returns null for anything that isn't a plain non-negative amount
 * with at most two decimal places.
 */
export function parseRupeesToPaise(input: string): Paise | null {
  const cleaned = input.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, rupeeDigits = "", paiseDigits = ""] = match;
  const paise = Number(rupeeDigits) * 100 + Number(paiseDigits.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}
