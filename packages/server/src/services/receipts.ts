/**
 * M6: receipts. A receipt only ever comes from a confirmed payment — a matched
 * bank credit, an owner's manual settle, or tenant-confirmed cash (CLAUDE.md §7.6).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { formatDate, formatINR, formatPeriod } from "@rentflow/core";
import type { Language } from "@rentflow/core";
import { receipts, type Queryable, type Tx } from "@rentflow/db";
import { eq, sql } from "drizzle-orm";
import { qrDataUrl } from "../media";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { automationStateForTenancy } from "./automation";
import { sendMessage } from "./notify";

export async function createReceipt(
  tx: Tx,
  input: { orgId: string; tenancyId: string; amountPaise: number; paymentMatchId?: string; cashEntryId?: string },
): Promise<string> {
  const seq = await one<{ receipt_seq: number }>(
    tx,
    sql`update orgs set receipt_seq = receipt_seq + 1 where id = ${input.orgId} returning receipt_seq`,
  );
  if (!seq) throw new Error("org not found");
  const [row] = await tx
    .insert(receipts)
    .values({
      orgId: input.orgId,
      tenancyId: input.tenancyId,
      paymentMatchId: input.paymentMatchId ?? null,
      cashEntryId: input.cashEntryId ?? null,
      number: `RCT-${String(seq.receipt_seq).padStart(5, "0")}`,
      amountPaise: input.amountPaise,
    })
    .returning({ id: receipts.id });
  if (!row) throw new Error("insert failed");
  return row.id;
}

// ─── Verification links (public page, no login) ─────────────────────────────

type TokenKind = "receipt" | "bill";

function sign(secret: string, kind: TokenKind, id: string): string {
  return createHmac("sha256", secret).update(`${kind}:${id}`).digest("base64url").slice(0, 22);
}

function verify(secret: string, kind: TokenKind, token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(sign(secret, kind, id));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export function receiptToken(secret: string, receiptId: string): string {
  return `${receiptId}.${sign(secret, "receipt", receiptId)}`;
}

/** Returns the receipt id if the token is genuine, else null. */
export function verifyReceiptToken(secret: string, token: string): string | null {
  return verify(secret, "receipt", token);
}

/** Public bill & pay page link token (`/p/<token>`, CLAUDE.md F2). */
export function billToken(secret: string, billId: string): string {
  return `${billId}.${sign(secret, "bill", billId)}`;
}

export function verifyBillToken(secret: string, token: string): string | null {
  return verify(secret, "bill", token);
}

// ─── The receipt itself ─────────────────────────────────────────────────────

export interface ReceiptView {
  id: string;
  orgId: string;
  number: string;
  issuedOn: string;
  amountPaise: number;
  method: string;
  utr: string | null;
  orgName: string;
  propertyName: string;
  propertyAddress: string | null;
  tenantName: string;
  tenantPhone: string;
  tenantLanguage: Language;
  tenancyId: string;
  room: string;
  bed: string;
  period: string | null;
  lines: { description: string; amountPaise: number }[];
  balanceAfterPaise: number;
  waPhoneNumberId: string | null;
  pdfRef: string | null;
}

export async function loadReceiptView(db: Queryable, receiptId: string): Promise<ReceiptView | null> {
  const r = await one<{
    id: string; org_id: string; number: string; issued_on: string; amount_paise: unknown; tenancy_id: string; pdf_ref: string | null;
    match_method: string | null; utr: string | null; cash_entry_id: string | null; bill_id: string | null;
    org_name: string; property_name: string; address: string | null; wa_phone_number_id: string | null;
    tenant_name: string; phone: string; language: Language; room: string; bed: string;
  }>(
    db,
    sql`select rc.id, rc.org_id, rc.number, (rc.created_at at time zone 'Asia/Kolkata')::date::text as issued_on, rc.amount_paise,
               rc.tenancy_id, rc.pdf_ref, pm.method as match_method, bc.utr, rc.cash_entry_id, pm.bill_id,
               o.name as org_name, p.name as property_name, p.address, p.wa_phone_number_id,
               t.name as tenant_name, t.phone, t.language, r.number as room, b.label as bed
        from receipts rc
        join orgs o on o.id = rc.org_id
        join tenancies tc on tc.id = rc.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        left join payment_matches pm on pm.id = rc.payment_match_id
        left join bank_credits bc on bc.id = pm.credit_id
        where rc.id = ${receiptId}`,
  );
  if (!r) return null;
  const billId = r.bill_id ?? (await one<{ id: string }>(db, sql`select b.id from bills b join billing_cycles c on c.id = b.cycle_id where b.tenancy_id = ${r.tenancy_id} and c.status <> 'draft' order by c.approved_at desc limit 1`))?.id ?? null;
  const bill = billId ? await one<{ period: string }>(db, sql`select c.period from bills b join billing_cycles c on c.id = b.cycle_id where b.id = ${billId}`) : null;
  const lines = billId ? await many<{ description: string; amount_paise: unknown }>(db, sql`select description, amount_paise from bill_lines where bill_id = ${billId} order by sort`) : [];
  const balance = await one<{ balance: unknown }>(
    db,
    sql`select coalesce(sum(amount_paise), 0) as balance from ledger_entries
        where tenancy_id = ${r.tenancy_id} and type in ('charge', 'payment', 'reversal', 'adjustment')
          and created_at <= (select created_at from receipts where id = ${receiptId})`,
  );
  const method = r.cash_entry_id ? "Cash (confirmed by tenant)" : r.match_method === "manual" ? "UPI / bank transfer (confirmed by owner)" : "UPI (matched with bank credit)";
  return {
    id: r.id,
    orgId: r.org_id,
    number: r.number,
    issuedOn: r.issued_on,
    amountPaise: toPaise(r.amount_paise),
    method,
    utr: r.utr,
    orgName: r.org_name,
    propertyName: r.property_name,
    propertyAddress: r.address,
    tenantName: r.tenant_name,
    tenantPhone: r.phone,
    tenantLanguage: r.language,
    tenancyId: r.tenancy_id,
    room: r.room,
    bed: r.bed,
    period: bill?.period ?? null,
    lines: lines.map((l) => ({ description: l.description, amountPaise: toPaise(l.amount_paise) })),
    balanceAfterPaise: toPaise(balance?.balance),
    waPhoneNumberId: r.wa_phone_number_id,
    pdfRef: r.pdf_ref,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export async function renderReceiptHtml(view: ReceiptView, verifyUrl: string): Promise<string> {
  const qr = await qrDataUrl(verifyUrl);
  const balance =
    view.balanceAfterPaise > 0 ? `Balance due: ${formatINR(view.balanceAfterPaise)}` : view.balanceAfterPaise < 0 ? `Advance: ${formatINR(-view.balanceAfterPaise)}` : "No balance due";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(view.number)}</title>
<style>
  *{box-sizing:border-box} body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:16px}
  h1{font-size:20px;margin:0 0 4px} .muted{color:#64748b} .paid{display:inline-block;background:#e6f4f1;color:#0f766e;font-weight:700;padding:4px 10px;border-radius:999px}
  table{width:100%;border-collapse:collapse;margin-top:16px} td{padding:6px 0;border-bottom:1px solid #e2e8f0} td.r{text-align:right}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:16px} .big{font-size:24px;font-weight:700}
  .foot{display:flex;justify-content:space-between;align-items:center;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px}
</style></head><body>
<div class="head"><div><h1>${esc(view.propertyName)}</h1><div class="muted">${esc(view.propertyAddress ?? view.orgName)}</div></div>
<div style="text-align:right"><div class="paid">PAID</div><div style="margin-top:6px">Receipt <b>${esc(view.number)}</b></div><div class="muted">${esc(formatDate(view.issuedOn))}</div></div></div>
<div class="grid">
  <div><span class="muted">Received from</span><br><b>${esc(view.tenantName)}</b></div>
  <div><span class="muted">Room / bed</span><br><b>${esc(view.room)}${esc(view.bed)}</b></div>
  <div><span class="muted">For</span><br>${view.period ? esc(formatPeriod(view.period)) : "-"}</div>
  <div><span class="muted">Paid by</span><br>${esc(view.method)}${view.utr ? `<br><span class="muted">UTR ${esc(view.utr)}</span>` : ""}</div>
</div>
${view.lines.length ? `<table>${view.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${esc(formatINR(l.amountPaise))}</td></tr>`).join("")}</table>` : ""}
<div class="grid" style="margin-top:20px"><div><span class="muted">Amount received</span><div class="big">${esc(formatINR(view.amountPaise))}</div></div>
<div><span class="muted">After this payment</span><br><b>${esc(balance)}</b></div></div>
<div class="foot"><div class="muted">Scan to verify this receipt is genuine.<br>Issued via RentFlow. RentFlow never asks you to pay anyone other than your PG.</div>
<img src="${qr}" width="110" height="110" alt="Verification QR"></div>
</body></html>`;
}

/** Job: render the PDF, store it, and send it to the tenant on WhatsApp. */
export async function sendReceipt(deps: AppDeps, receiptId: string): Promise<void> {
  const view = await loadReceiptView(deps.db, receiptId);
  if (!view) return;
  const verifyUrl = `${deps.config.appUrl}/r/${receiptToken(deps.config.receiptSecret, receiptId)}`;
  let pdfRef = view.pdfRef;
  if (!pdfRef) {
    const html = await renderReceiptHtml(view, verifyUrl);
    const pdf = await deps.pdf.render(html);
    pdfRef = `${view.orgId}/receipts/${view.number}.${pdf ? "pdf" : "html"}`;
    await deps.files.put(pdfRef, pdf ?? Buffer.from(html, "utf8"), pdf ? "application/pdf" : "text/html; charset=utf-8");
    await deps.db.update(receipts).set({ pdfRef }).where(eq(receipts.id, receiptId));
  }
  // The receipt always exists (and is on the /r page); the WhatsApp message follows the owner's automation settings.
  const state = await automationStateForTenancy(deps.db, view.tenancyId, view.tenantLanguage);
  if (!state || state.paused || !state.automations.payment_confirmation.enabled) return;
  const balance = view.balanceAfterPaise > 0 ? formatINR(view.balanceAfterPaise) : view.balanceAfterPaise < 0 ? `${formatINR(-view.balanceAfterPaise)} advance` : formatINR(0);
  await sendMessage(
    deps,
    { phone: view.tenantPhone, orgId: view.orgId, tenancyId: view.tenancyId, phoneNumberId: view.waPhoneNumberId },
    {
      kind: "template",
      name: "rf_payment_received",
      language: view.tenantLanguage,
      variables: [view.propertyName, formatINR(view.amountPaise), view.number, balance, state.automations.payment_confirmation.note],
      header: { kind: "document", fileKey: pdfRef, filename: `${view.number}.pdf` },
    },
    { receiptId, automation: "payment_confirmation" },
  );
  await deps.db.update(receipts).set({ sentAt: deps.now() }).where(eq(receipts.id, receiptId));
}
