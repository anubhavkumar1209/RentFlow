/**
 * Sample credit alerts, one per supported bank. Used by the parser tests and by
 * the demo's "bank email" simulator. Replace with real (redacted) emails as soon
 * as you have them: wording varies by bank and changes over time.
 */
import type { BankCode, InboundEmail, ParsedCredit } from "./index";

export interface BankFixture {
  name: string;
  bank: BankCode;
  email: InboundEmail;
  expected: ParsedCredit;
}

export const BANK_FIXTURES: BankFixture[] = [
  {
    name: "HDFC UPI credit",
    bank: "hdfc",
    email: {
      from: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
      subject: "You have received a payment",
      text: "Dear Customer,\n\nRs.2866.42 has been credited to your account **1234 by VPA anubhav@okaxis ANUBHAV KUMAR on 02-11-26.\nYour UPI transaction reference number is 630612345678.\n\nWarm Regards,\nHDFC Bank",
    },
    expected: { bank: "hdfc", amountPaise: 286642, utr: "630612345678", payerName: "ANUBHAV KUMAR", payerVpa: "anubhav@okaxis", creditedOn: "2026-11-02" },
  },
  {
    name: "ICICI UPI credit",
    bank: "icici",
    email: {
      from: "ICICI Bank <credit_cards@icicibank.com>",
      subject: "Transaction alert for your ICICI Bank Account",
      text: "Dear Customer, Your account XX123 has been credited with INR 3,251.07 on 02-Nov-26. Info: UPI/630698765432/ANMOL SINGH/anmol@ybl. The Available Balance is INR 1,00,000.00.",
    },
    expected: { bank: "icici", amountPaise: 325107, utr: "630698765432", payerName: "ANMOL SINGH", payerVpa: "anmol@ybl", creditedOn: "2026-11-02" },
  },
  {
    name: "SBI credit",
    bank: "sbi",
    email: {
      from: "SBI Alerts <donotreply.sbiatm@alerts.sbi.co.in>",
      subject: "Credit alert",
      text: "Dear Customer, your A/c X1234 has been credited by Rs.5000.03 on 03Nov26 transfer from PRIYA SHARMA Ref No 630611112222 -SBI",
    },
    expected: { bank: "sbi", amountPaise: 500003, utr: "630611112222", payerName: "PRIYA SHARMA", payerVpa: null, creditedOn: "2026-11-03" },
  },
  {
    name: "Axis UPI credit",
    bank: "axis",
    email: {
      from: "Axis Bank Alerts <alerts@axisbank.com>",
      subject: "Credit transaction alert",
      text: "INR 7500.15 credited to A/c no. XX1234 on 04-11-2026 at 10:15:01 IST. Info- UPI/P2A/630633334444/RAHUL VERMA/rahul.v@paytm. Available balance: INR 52,000.00",
    },
    expected: { bank: "axis", amountPaise: 750015, utr: "630633334444", payerName: "RAHUL VERMA", payerVpa: "rahul.v@paytm", creditedOn: "2026-11-04" },
  },
  {
    name: "Kotak UPI credit",
    bank: "kotak",
    email: {
      from: "Kotak Mahindra Bank <bankalerts@kotak.com>",
      subject: "Credit alert",
      text: "Rs.4200.09 is credited to your Kotak Bank a/c XX1234 by neha@okicici on 05/11/26. UPI Ref: 630655556666.",
    },
    expected: { bank: "kotak", amountPaise: 420009, utr: "630655556666", payerName: null, payerVpa: "neha@okicici", creditedOn: "2026-11-05" },
  },
  {
    name: "PNB UPI credit",
    bank: "pnb",
    email: {
      from: "PNB <alerts@pnb.co.in>",
      subject: "Account credited",
      text: "Your A/c XX1234 is credited with INR 6,100.11 on 06-11-2026 by UPI ref no 630677778888 from VIKAS YADAV. -PNB",
    },
    expected: { bank: "pnb", amountPaise: 610011, utr: "630677778888", payerName: "VIKAS YADAV", payerVpa: null, creditedOn: "2026-11-06" },
  },
];

/** Builds a sample alert for the demo simulator with the given amount, UTR and payer. */
export function sampleCreditEmail(bank: BankCode, input: { amountPaise: number; utr: string; payerName: string; payerVpa: string; date: string }): InboundEmail {
  const fixture = BANK_FIXTURES.find((f) => f.bank === bank);
  if (!fixture) throw new Error(`No fixture for ${bank}`);
  const e = fixture.expected;
  const rupees = `${Math.trunc(input.amountPaise / 100)}.${String(input.amountPaise % 100).padStart(2, "0")}`;
  const [y, m, d] = input.date.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] ?? "Jan";
  const dates: Record<BankCode, string> = {
    hdfc: `${d}-${m}-${y?.slice(2)}`,
    icici: `${d}-${mon}-${y?.slice(2)}`,
    sbi: `${d}${mon}${y?.slice(2)}`,
    axis: `${d}-${m}-${y}`,
    kotak: `${d}/${m}/${y?.slice(2)}`,
    pnb: `${d}-${m}-${y}`,
  };
  let text = fixture.email.text;
  const originalAmount = /(?:Rs\.?|INR)\s?([\d,]+\.\d{2})/.exec(text)?.[1] ?? "";
  text = text.replace(originalAmount, rupees);
  if (e.utr) text = text.replace(e.utr, input.utr);
  if (e.payerName) text = text.replace(e.payerName, input.payerName.toUpperCase());
  if (e.payerVpa) text = text.replace(e.payerVpa, input.payerVpa);
  const originalDate = { hdfc: "02-11-26", icici: "02-Nov-26", sbi: "03Nov26", axis: "04-11-2026", kotak: "05/11/26", pnb: "06-11-2026" }[bank];
  text = text.replace(originalDate, dates[bank]);
  return { ...fixture.email, text };
}
