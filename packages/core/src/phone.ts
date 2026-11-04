/**
 * Phone numbers are stored in E.164 ("+919876543210"). A tenant's WhatsApp
 * number is their identity, so every number entering the system goes through
 * normalizePhone first.
 */

const E164 = /^\+[1-9]\d{7,14}$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function isE164(value: string): boolean {
  return E164.test(value);
}

/**
 * Normalises a phone number typed by a person. Numbers without a country code
 * are treated as Indian mobiles. Returns null if the number isn't valid.
 *
 *   "98765 43210"       → "+919876543210"
 *   "098765-43210"      → "+919876543210"
 *   "91 98765 43210"    → "+919876543210"
 *   "+44 7700 900123"   → "+447700900123"
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");

  if (hasPlus) {
    const candidate = `+${digits}`;
    if (!isE164(candidate)) return null;
    if (candidate.startsWith("+91") && !INDIAN_MOBILE.test(candidate.slice(3))) return null;
    return candidate;
  }

  let national = digits;
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  return INDIAN_MOBILE.test(national) ? `+91${national}` : null;
}

/** "+919876543210" → "+91 98765 43210" for display; other numbers are returned as-is. */
export function formatPhone(e164: string): string {
  if (e164.startsWith("+91") && e164.length === 13) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  }
  return e164;
}
