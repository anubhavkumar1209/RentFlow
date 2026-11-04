/**
 * M4: incoming WhatsApp messages. Resolves the sender to their tenancies on the
 * shared number (CLAUDE.md §5), runs the pure state machine from @rentflow/core,
 * then sends the replies and applies the effects.
 */
import {
  botText,
  buildMenu,
  formatINR,
  handleBotMessage,
  normalizePhone,
  type BotBill,
  type BotContext,
  type BotEffect,
  type BotInput,
  type BotSnapshot,
  type BotState,
  type BotTenancy,
  type MenuService,
} from "@rentflow/core";
import type { Language } from "@rentflow/core";
import { conversations } from "@rentflow/db";
import { eq, sql } from "drizzle-orm";
import type { AppDeps } from "../ports";
import { many, one, toPaise } from "../sql";
import { respondToCash } from "./cash";
import { respondToRefund } from "./checkout";
import { logInbound, sendMessage, type Recipient } from "./notify";
import { sendPaymentDetails } from "./outbound";
import { saveScreenshotClaim, setClaimUtrLast4 } from "./payments";

export type IncomingMessage =
  | { kind: "text"; text: string }
  | { kind: "reply"; id: string; title?: string }
  | { kind: "image"; bytes: Buffer; contentType: string };

interface TenancyRow extends BotTenancy {
  orgId: string;
  propertyId: string;
  waPhoneNumberId: string | null;
}

const WINDOW_MS = 24 * 3_600_000;

export async function handleIncoming(deps: AppDeps, fromRaw: string, message: IncomingMessage, waMessageId: string | null = null): Promise<void> {
  const phone = normalizePhone(fromRaw.startsWith("+") ? fromRaw : `+${fromRaw}`) ?? fromRaw;
  const list = await tenanciesFor(deps, phone);

  const [conv] = await deps.db
    .insert(conversations)
    .values({ phone, windowExpiresAt: new Date(deps.now().getTime() + WINDOW_MS) })
    .onConflictDoUpdate({ target: conversations.phone, set: { windowExpiresAt: new Date(deps.now().getTime() + WINDOW_MS) } })
    .returning();
  if (!conv) throw new Error("conversation upsert failed");

  // One current stay: no need to ask "which PG?".
  let selected = list.find((t) => t.tenancyId === conv.tenancyId) ?? (list.length === 1 ? (list[0] ?? null) : null);
  await logInbound(
    deps,
    { phone, orgId: selected?.orgId ?? list[0]?.orgId ?? null, tenancyId: selected?.tenancyId ?? null },
    message.kind === "image" ? { kind: "image", contentType: message.contentType, bytes: message.bytes.length } : message,
    waMessageId,
  );

  let state = conv.state as BotState;
  let context = conv.context as BotContext;
  let input: BotInput = message.kind === "image" ? { kind: "image" } : message.kind === "reply" ? { kind: "reply", id: message.id } : { kind: "text", text: message.text };

  // At most two passes: the second runs after the engine picks a tenancy.
  for (let pass = 0; pass < 2; pass++) {
    const snap = await snapshot(deps, list, selected);
    const result = handleBotMessage(state, context, input, snap);
    const to = recipient(phone, selected ?? list[0] ?? null);
    for (const reply of result.replies) await sendMessage(deps, to, reply);
    state = result.state;
    context = result.context;

    const select = result.effects.find((e): e is Extract<BotEffect, { type: "select_tenancy" }> => e.type === "select_tenancy");
    if (select) {
      selected = list.find((t) => t.tenancyId === select.tenancyId) ?? null;
      await deps.db.update(conversations).set({ tenancyId: selected?.tenancyId ?? null, orgId: selected?.orgId ?? null }).where(eq(conversations.id, conv.id));
      input = { kind: "reply", id: select.then === "menu" ? "menu:show" : `menu:${select.then}` };
      context = {};
      continue;
    }
    const override = await applyEffects(deps, phone, result.effects, selected, snap, message);
    if (override) state = override;
    break;
  }
  await deps.db.update(conversations).set({ state, context, tenancyId: selected?.tenancyId ?? null, orgId: selected?.orgId ?? null }).where(eq(conversations.id, conv.id));
}

function recipient(phone: string, t: TenancyRow | null): Recipient {
  return { phone, orgId: t?.orgId ?? null, tenancyId: t?.tenancyId ?? null, phoneNumberId: t?.waPhoneNumberId ?? null };
}

async function tenanciesFor(deps: AppDeps, phone: string): Promise<TenancyRow[]> {
  const rows = await many<{ tenancy_id: string; org_id: string; property_id: string; property_name: string; room: string; bed: string; tenant_name: string; language: Language; wa_phone_number_id: string | null }>(
    deps.db,
    sql`select tc.id as tenancy_id, tc.org_id, p.id as property_id, p.name as property_name, r.number as room, b.label as bed,
               t.name as tenant_name, t.language, p.wa_phone_number_id
        from tenants t join tenancies tc on tc.tenant_id = t.id join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        join properties p on p.id = r.property_id
        where t.phone = ${phone} and tc.status in ('active', 'notice') order by tc.check_in`,
  );
  return rows.map((r) => ({
    tenancyId: r.tenancy_id,
    orgId: r.org_id,
    propertyId: r.property_id,
    propertyName: r.property_name,
    roomNumber: r.room,
    bedLabel: r.bed,
    tenantName: r.tenant_name,
    language: r.language,
    waPhoneNumberId: r.wa_phone_number_id,
  }));
}

async function snapshot(deps: AppDeps, list: TenancyRow[], selected: TenancyRow | null): Promise<BotSnapshot> {
  if (!selected) return { tenancies: list, selected: null, bill: null, menu: null };
  const services = await many<{ id: string; name: string; type: MenuService["type"]; active: boolean; menu_order: number }>(
    deps.db,
    sql`select id, name, type, active, menu_order from services where property_id = ${selected.propertyId}`,
  );
  const menu = buildMenu({
    propertyName: selected.propertyName,
    language: selected.language,
    services: services.map((s) => ({ id: s.id, name: s.name, type: s.type, active: s.active, menuOrder: s.menu_order })),
  });
  return { tenancies: list, selected, bill: await latestBill(deps, selected.tenancyId), menu };
}

async function latestBill(deps: AppDeps, tenancyId: string): Promise<BotBill | null> {
  const b = await one<{ id: string; period: string; due_date: string; total_paise: unknown; payable_paise: unknown; status: string; balance: unknown }>(
    deps.db,
    sql`select b.id, c.period, c.due_date::text as due_date, b.total_paise, b.payable_paise, b.status,
               (select coalesce(sum(amount_paise), 0) from ledger_entries e where e.tenancy_id = b.tenancy_id
                and e.type in ('charge', 'payment', 'reversal', 'adjustment')) as balance
        from bills b join billing_cycles c on c.id = b.cycle_id
        where b.tenancy_id = ${tenancyId} and c.status <> 'draft' order by c.approved_at desc limit 1`,
  );
  if (!b) return null;
  const lines = await many<{ description: string; amount_paise: unknown }>(deps.db, sql`select description, amount_paise from bill_lines where bill_id = ${b.id} order by sort`);
  return {
    billId: b.id,
    period: b.period,
    dueDate: b.due_date,
    totalPaise: toPaise(b.total_paise),
    payablePaise: toPaise(b.payable_paise),
    outstandingPaise: Math.max(0, toPaise(b.balance)),
    paid: b.status === "paid",
    lines: lines.map((l) => ({ description: l.description, amountPaise: toPaise(l.amount_paise) })),
  };
}

/** Applies side effects; may return a state override (e.g. a rejected screenshot). */
async function applyEffects(
  deps: AppDeps,
  phone: string,
  effects: BotEffect[],
  selected: TenancyRow | null,
  snap: BotSnapshot,
  message: IncomingMessage,
): Promise<BotState | null> {
  const lang = selected?.language ?? snap.tenancies[0]?.language ?? "en";
  const t = botText(lang);
  const to = recipient(phone, selected ?? (snap.tenancies[0] as TenancyRow | undefined) ?? null);
  const say = (text: string) => sendMessage(deps, to, { kind: "text", text: selected ? `*${selected.propertyName}*\n${text}` : text });
  let override: BotState | null = null;

  for (const effect of effects) {
    switch (effect.type) {
      case "send_payment":
        if (snap.bill) await sendPaymentDetails(deps, snap.bill.billId);
        break;
      case "save_screenshot": {
        if (!selected || message.kind !== "image") break;
        const { duplicate } = await saveScreenshotClaim(deps, { orgId: selected.orgId, tenancyId: selected.tenancyId, bytes: message.bytes, contentType: message.contentType });
        await say(duplicate ? t.screenshotDuplicate : t.screenshotReceived);
        if (duplicate) override = "idle";
        break;
      }
      case "set_utr_last4":
        if (selected) await setClaimUtrLast4(deps, selected.orgId, selected.tenancyId, effect.last4);
        break;
      case "send_receipts": {
        if (!selected) break;
        const recent = await many<{ number: string; pdf_ref: string | null; amount_paise: unknown }>(
          deps.db,
          sql`select number, pdf_ref, amount_paise from receipts where tenancy_id = ${selected.tenancyId} order by created_at desc limit 3`,
        );
        if (recent.length === 0) {
          await say(t.noReceipts);
          break;
        }
        await say(t.receiptsIntro(recent.length));
        for (const r of recent) {
          if (r.pdf_ref) await sendMessage(deps, to, { kind: "document", fileKey: r.pdf_ref, filename: `${r.number}.pdf`, caption: `${r.number} · ${formatINR(toPaise(r.amount_paise))}` });
          else await say(`${r.number} · ${formatINR(toPaise(r.amount_paise))}`);
        }
        break;
      }
      case "alert_manager": {
        if (!selected) break;
        const staff = await many<{ name: string | null; phone: string; role: string }>(
          deps.db,
          sql`select u.name, u.phone, m.role from org_members m join users u on u.id = m.user_id
              where m.org_id = ${selected.orgId}
                and (m.role = 'owner' or exists (select 1 from user_property_access a where a.user_id = m.user_id and a.property_id = ${selected.propertyId}))
              order by (m.role = 'manager') desc, m.created_at`,
        );
        const text = `${selected.tenantName} (room ${selected.roomNumber}${selected.bedLabel}) wants to talk. WhatsApp/call: ${phone}`;
        for (const s of staff) {
          await sendMessage(deps, { phone: s.phone, orgId: selected.orgId }, { kind: "template", name: "rf_staff_alert", language: "en", variables: [selected.propertyName, text] }).catch(() => undefined);
        }
        const first = staff[0];
        await say(first ? t.managerContact(first.name ?? "", first.phone) : t.managerUnavailable);
        break;
      }
      case "consent":
        await deps.db.execute(sql`update tenants set consent_at = coalesce(consent_at, now()) where phone = ${phone}`);
        break;
      case "cash_response": {
        const r = await respondToCash(deps, phone, effect.entryId, effect.correct);
        if (r !== "not_found") await say(r === "already" ? t.alreadyAnswered : effect.correct ? t.cashThanks : t.cashDisputed);
        break;
      }
      case "refund_response": {
        const r = await respondToRefund(deps, phone, effect.tenancyId, effect.received);
        if (r !== "not_found") await say(r === "already" ? t.alreadyAnswered : effect.received ? t.refundThanks : t.refundDisputed);
        break;
      }
      case "select_tenancy":
        break;
    }
  }
  return override;
}

