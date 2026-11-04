/**
 * M4: business-initiated messages — welcome, monthly bill — and the payment
 * message (QR image + UPI link) the bot sends when a tenant taps "Pay now".
 */
import { botText, formatDate, formatINR, formatPeriod, formatUpiPhone, pack, PAY_ONLY_WARNING, PAY_PAGE_PATH, paymentDetailsLine, upiNote, upiPayLink, type BotLanguage } from "@rentflow/core";
import { billingCycles, bills } from "@rentflow/db";
import { eq, sql } from "drizzle-orm";
import { qrPng } from "../media";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { automationStateForProperty } from "./automation";
import { shortBreakdown } from "./billing";
import { billToken } from "./receipts";
import { sendMessage } from "./notify";

export async function sendWelcome(deps: AppDeps, tenancyId: string): Promise<void> {
  const t = await one<{ org_id: string; tenant_name: string; phone: string; language: BotLanguage; property_name: string; room: string; bed: string; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select tc.org_id, t.name as tenant_name, t.phone, t.language, p.name as property_name, r.number as room, b.label as bed, p.wa_phone_number_id
        from tenancies tc join tenants t on t.id = tc.tenant_id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where tc.id = ${tenancyId}`,
  );
  if (!t) return;
  await sendMessage(
    deps,
    { phone: t.phone, orgId: t.org_id, tenancyId, phoneNumberId: t.wa_phone_number_id },
    {
      kind: "template",
      name: "rf_welcome",
      language: t.language,
      variables: [t.property_name, t.tenant_name.split(" ")[0] ?? t.tenant_name, t.room, t.bed],
      buttonIds: ["consent:yes", "consent:menu"],
    },
  );
}

interface PayInfo {
  billId: string;
  orgId: string;
  tenancyId: string;
  period: string;
  dueDate: string;
  totalPaise: number;
  payablePaise: number;
  vpa: string | null;
  payeeName: string;
  upiPhone: string | null;
  propertyId: string;
  propertyName: string;
  room: string;
  bed: string;
  phone: string;
  language: BotLanguage;
  waPhoneNumberId: string | null;
}

async function payInfo(deps: AppDeps, billId: string): Promise<PayInfo | null> {
  const r = await one<{ org_id: string; tenancy_id: string; period: string; due_date: string; total_paise: unknown; payable_paise: unknown; upi_vpa: string | null; payee_name: string | null; upi_phone: string | null; property_id: string; property_name: string; room: string; bed: string; phone: string; language: BotLanguage; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select b.org_id, b.tenancy_id, c.period, c.due_date::text as due_date, b.total_paise, b.payable_paise, p.upi_vpa, p.payee_name, p.upi_phone, p.id as property_id, p.name as property_name,
               r.number as room, bd.label as bed, t.phone, t.language, p.wa_phone_number_id
        from bills b join billing_cycles c on c.id = b.cycle_id join tenancies tc on tc.id = b.tenancy_id join tenants t on t.id = tc.tenant_id
        join beds bd on bd.id = tc.bed_id join rooms r on r.id = bd.room_id join properties p on p.id = r.property_id
        where b.id = ${billId}`,
  );
  if (!r) return null;
  return {
    billId,
    orgId: r.org_id,
    tenancyId: r.tenancy_id,
    period: r.period,
    dueDate: r.due_date,
    totalPaise: toPaise(r.total_paise),
    payablePaise: toPaise(r.payable_paise),
    vpa: r.upi_vpa,
    payeeName: r.payee_name ?? r.property_name,
    upiPhone: r.upi_phone,
    propertyId: r.property_id,
    propertyName: r.property_name,
    room: r.room,
    bed: r.bed,
    phone: r.phone,
    language: r.language,
    waPhoneNumberId: r.wa_phone_number_id,
  };
}

/** Stores (once) and returns the QR image for a bill's exact payable amount. */
async function billQr(deps: AppDeps, info: PayInfo, link: string): Promise<string> {
  const key = `${info.orgId}/qr/${info.billId}-${info.payablePaise}.png`;
  if (!(await deps.files.get(key))) await deps.files.put(key, await qrPng(link), "image/png");
  return key;
}

function payLink(info: PayInfo): string | null {
  if (!info.vpa) return null;
  return upiPayLink({ vpa: info.vpa, payeeName: info.payeeName, amountPaise: info.payablePaise, note: upiNote(info.room, info.bed, info.period) });
}

/** The tenant's bill & pay page (CLAUDE.md F2). */
export function payPageUrl(deps: AppDeps, billId: string): string {
  return `${deps.config.appUrl}${PAY_PAGE_PATH}${billToken(deps.config.receiptSecret, billId)}`;
}

/** Job: send every bill of an approved cycle (template + QR header). Held while the owner has paused automations. */
export async function sendCycleBills(deps: AppDeps, cycleId: string): Promise<{ sent: number; failed: number }> {
  const cycle = await one<{ property_id: string }>(deps.db, sql`select property_id from billing_cycles where id = ${cycleId}`);
  const state = cycle ? await automationStateForProperty(deps.db, cycle.property_id) : null;
  if (!state || state.paused) return { sent: 0, failed: 0 };
  // The owner's note, or the default note in each tenant's language.
  const notes = new Map<string, string>();
  const noteFor = async (language: BotLanguage) => {
    if (!notes.has(language)) notes.set(language, (await automationStateForProperty(deps.db, cycle!.property_id, language))!.automations.bill.note);
    return notes.get(language)!;
  };
  const list = await many<{ id: string }>(deps.db, sql`select id from bills where cycle_id = ${cycleId} and sent_at is null and total_paise > 0 order by created_at`);
  let sent = 0;
  let failed = 0;
  for (const { id } of list) {
    const info = await payInfo(deps, id);
    if (!info) continue;
    const lines = await many<{ kind: string; description: string; amount_paise: unknown }>(deps.db, sql`select kind, description, amount_paise from bill_lines where bill_id = ${id} order by sort`);
    const link = payLink(info);
    try {
      await sendMessage(
        deps,
        { phone: info.phone, orgId: info.orgId, tenancyId: info.tenancyId, phoneNumberId: info.waPhoneNumberId },
        {
          kind: "template",
          name: "rf_bill",
          language: info.language,
          variables: [
            info.propertyName,
            formatPeriod(info.period),
            formatINR(info.totalPaise),
            formatINR(info.payablePaise),
            formatDate(info.dueDate),
            shortBreakdown(lines.map((l) => ({ kind: l.kind, description: l.description, amountPaise: toPaise(l.amount_paise) }))),
            paymentDetailsLine({ vpa: info.vpa, payeeName: info.payeeName, upiPhone: info.upiPhone }, info.language),
            await noteFor(info.language),
          ],
          buttonIds: ["menu:view_bill"],
          urlSuffix: billToken(deps.config.receiptSecret, id),
          ...(link ? { header: { kind: "image" as const, fileKey: await billQr(deps, info, link) } } : {}),
        },
        { billId: id, automation: "bill" },
      );
      await deps.db.update(bills).set({ sentAt: deps.now() }).where(eq(bills.id, id));
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed === 0) await deps.db.update(billingCycles).set({ status: "sent" }).where(eq(billingCycles.id, cycleId));
  return { sent, failed };
}

/** "Pay now": QR image + UPI link + the pay-only warning (CLAUDE.md §9.2, §14). */
export async function sendPaymentDetails(deps: AppDeps, billId: string): Promise<void> {
  const info = await payInfo(deps, billId);
  if (!info) return;
  const to = { phone: info.phone, orgId: info.orgId, tenancyId: info.tenancyId, phoneNumberId: info.waPhoneNumberId };
  const t = botText(info.language);
  const link = payLink(info);
  if (!link) {
    await sendMessage(deps, to, { kind: "text", text: `*${info.propertyName}*\nPlease pay ${formatINR(info.payablePaise)} to your PG — UPI isn't set up yet, so ask your manager how.` });
    return;
  }
  const amount = formatINR(info.payablePaise);
  await sendMessage(deps, to, { kind: "image", fileKey: await billQr(deps, info, link), caption: `*${info.propertyName}* · ${amount}\n${PAY_ONLY_WARNING[info.language]}` });
  // upi:// links aren't tappable inside WhatsApp, so the tenant opens the pay page, which hands off to their UPI app.
  const page = pack(info.language).pay.pageLink(payPageUrl(deps, billId));
  const phone = formatUpiPhone(info.upiPhone);
  await sendMessage(deps, to, {
    kind: "text",
    text: `*${info.propertyName}*\n${t.payInstructions(amount)}\n\n${page}\n\nUPI ID: ${info.vpa} (${info.payeeName})${phone ? `\nUPI number: ${phone}` : ""}\n\n${PAY_ONLY_WARNING[info.language]}`,
  });
}
