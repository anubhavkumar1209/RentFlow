/**
 * The tenant's public bill & pay page, `/p/<token>` (CLAUDE.md F2). No login:
 * the signed token is the key, and only what the tenant needs is shown (first
 * name, bed, amounts). "Paid" appears only once money is confirmed (F2, E9).
 */
import { formatUpiPhone, upiAppLinks, upiNote, upiPayLink, type BotLanguage } from "@rentflow/core";
import { sql } from "drizzle-orm";
import { qrDataUrl } from "../media";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { saveScreenshotClaim } from "./payments";
import { receiptToken, verifyBillToken } from "./receipts";

export type PayStatus = "unpaid" | "confirming" | "partially_paid" | "paid";

export interface PayPage {
  propertyName: string;
  firstName: string;
  room: string;
  bed: string;
  period: string;
  dueDate: string;
  language: BotLanguage;
  status: PayStatus;
  lines: { description: string; amountPaise: number }[];
  totalPaise: number;
  /** What to pay now: the unique payable amount, or what is left after a part payment. */
  toPayPaise: number;
  payeeName: string;
  vpa: string | null;
  upiPhone: string | null;
  upiLink: string | null;
  appLinks: { app: string; label: string; href: string }[];
  qr: string | null;
  receiptUrl: string | null;
}

async function billFor(deps: AppDeps, token: string) {
  const billId = verifyBillToken(deps.config.receiptSecret, token);
  if (!billId) return null;
  return one<{
    id: string; org_id: string; tenancy_id: string; status: string; total_paise: unknown; payable_paise: unknown; approved_at: string | null; period: string; due_date: string;
    property_name: string; payee_name: string | null; upi_vpa: string | null; upi_phone: string | null; tenant_name: string; language: BotLanguage; room: string; bed: string;
  }>(
    deps.db,
    sql`select b.id, b.org_id, b.tenancy_id, b.status, b.total_paise, b.payable_paise, c.approved_at::text as approved_at, c.period, c.due_date::text as due_date,
               p.name as property_name, p.payee_name, p.upi_vpa, p.upi_phone, t.name as tenant_name, t.language, r.number as room, bd.label as bed
        from bills b join billing_cycles c on c.id = b.cycle_id join tenancies tc on tc.id = b.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id join properties p on p.id = r.property_id
        where b.id = ${billId} and c.status <> 'draft'`,
  );
}

export async function loadPayPage(deps: AppDeps, token: string): Promise<PayPage | null> {
  const b = await billFor(deps, token);
  if (!b) return null;
  const lines = await many<{ description: string; amount_paise: unknown }>(deps.db, sql`select description, amount_paise from bill_lines where bill_id = ${b.id} order by sort`);
  const balance = await one<{ balance: unknown }>(
    deps.db,
    sql`select coalesce(sum(amount_paise), 0) as balance from ledger_entries where tenancy_id = ${b.tenancy_id} and type in ('charge', 'payment', 'reversal', 'adjustment')`,
  );
  const claim = await one<{ id: string }>(
    deps.db,
    sql`select id from payment_claims where tenancy_id = ${b.tenancy_id} and status = 'claimed' and created_at >= coalesce(${b.approved_at}::timestamptz, '-infinity') limit 1`,
  );
  const left = Math.max(0, toPaise(balance?.balance));
  const status: PayStatus = b.status === "paid" ? "paid" : b.status === "partially_paid" ? "partially_paid" : claim ? "confirming" : "unpaid";
  const toPayPaise = status === "paid" ? 0 : status === "partially_paid" ? left : toPaise(b.payable_paise);
  const payeeName = b.payee_name ?? b.property_name;
  const pay = b.upi_vpa && toPayPaise > 0 ? { vpa: b.upi_vpa, payeeName, amountPaise: toPayPaise, note: upiNote(b.room, b.bed, b.period) } : null;
  const upiLink = pay ? upiPayLink(pay) : null;
  let receiptUrl: string | null = null;
  if (status === "paid") {
    const receipt = await one<{ id: string }>(deps.db, sql`select id from receipts where tenancy_id = ${b.tenancy_id} order by created_at desc limit 1`);
    if (receipt) receiptUrl = `/r/${receiptToken(deps.config.receiptSecret, receipt.id)}`;
  }
  return {
    propertyName: b.property_name,
    firstName: b.tenant_name.split(" ")[0] ?? b.tenant_name,
    room: b.room,
    bed: b.bed,
    period: b.period,
    dueDate: b.due_date,
    language: b.language,
    status,
    lines: lines.map((l) => ({ description: l.description, amountPaise: toPaise(l.amount_paise) })),
    totalPaise: toPaise(b.total_paise),
    toPayPaise,
    payeeName,
    vpa: b.upi_vpa,
    upiPhone: formatUpiPhone(b.upi_phone),
    upiLink,
    appLinks: pay ? upiAppLinks(pay) : [],
    qr: upiLink ? await qrDataUrl(upiLink) : null,
    receiptUrl,
  };
}

export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * "I've paid" with a screenshot from the pay page. Stored as a claim, a hint
 * for matching only: the bill stays unpaid until the money is confirmed.
 */
export async function submitPayScreenshot(deps: AppDeps, token: string, file: { bytes: Buffer; contentType: string }): Promise<"saved" | "duplicate" | "invalid"> {
  const b = await billFor(deps, token);
  if (!b || b.status === "paid") return "invalid";
  if (!/^image\/(png|jpe?g|webp)$/.test(file.contentType) || file.bytes.length === 0 || file.bytes.length > SCREENSHOT_MAX_BYTES) return "invalid";
  const { duplicate } = await saveScreenshotClaim(deps, { orgId: b.org_id, tenancyId: b.tenancy_id, bytes: file.bytes, contentType: file.contentType });
  return duplicate ? "duplicate" : "saved";
}
