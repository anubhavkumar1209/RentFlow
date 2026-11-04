import { formatINR, formatPhone, PAY_PAGE_PATH, SUPPORTED_BANKS, TEMPLATES, todayInIndia, type Language, type WhatsAppMenu } from "@rentflow/core";
import { queries } from "@rentflow/server";
import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { Check, Empty, Field, Page, Section, Select } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { isDemo } from "@/lib/env";
import { asCurrentUser, requireOwnerActor } from "@/lib/session";
import { bankEmailAction, dailyAction, tenantSendsAction } from "./actions";
import { AutoRefresh } from "./auto-refresh";

interface LogRow {
  id: string;
  direction: "in" | "out";
  template_name: string | null;
  status: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/** WhatsApp-style *bold*. */
function waText(text: string): ReactNode[] {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) => (part.startsWith("*") && part.endsWith("*") ? <b key={i}>{part.slice(1, -1)}</b> : <span key={i}>{part}</span>));
}

function ReplyButton({ phone, id, title }: { phone: string; id: string; title: string }) {
  return (
    <ActionForm action={tenantSendsAction} submit={title} inline variant="secondary">
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="replyId" value={id} />
    </ActionForm>
  );
}

function Bubble({ row, phone }: { row: LogRow; phone: string }) {
  const p = row.payload;
  const out = row.direction === "out";
  const kind = String(p.kind ?? "");
  let body: ReactNode;
  let buttons: { id: string; title: string }[] = [];

  if (!out) {
    body = kind === "image" ? <i>📷 Photo</i> : kind === "reply" ? <i>Tapped: {String(p.title ?? p.id)}</i> : waText(String(p.text ?? ""));
  } else if (kind === "template") {
    const header = p.header as { kind: string; fileKey: string } | undefined;
    const ids = (p.buttonIds as string[] | undefined) ?? [];
    const titles = TEMPLATES[row.template_name as keyof typeof TEMPLATES]?.buttons[(p.language as Language) ?? "en"] ?? [];
    buttons = ids.map((id, i) => ({ id, title: titles[i] ?? id }));
    body = (
      <>
        {header?.kind === "image" ? <img src={`/files/${header.fileKey}`} alt="QR" className="mb-2 w-48 rounded-[var(--radius-input)] bg-card" /> : null}
        {header?.kind === "document" ? (
          <a href={`/files/${header.fileKey}`} target="_blank" rel="noreferrer" className="mb-2 block rounded-[var(--radius-input)] bg-card/70 px-3 py-2 text-sm font-medium underline">
            📄 Receipt (PDF)
          </a>
        ) : null}
        {waText(String(p.text ?? ""))}
        {/* The template's link button ("Pay now") opens the tenant's bill & pay page, as on a phone. */}
        {TEMPLATES[row.template_name as keyof typeof TEMPLATES]?.url && typeof p.urlSuffix === "string" ? (
          <a href={`${PAY_PAGE_PATH}${p.urlSuffix}`} target="_blank" rel="noreferrer" className="mt-2 flex h-9 items-center justify-center rounded-[var(--radius-input)] border border-line bg-card text-sm font-semibold text-[#027eb5]">
            {TEMPLATES[row.template_name as keyof typeof TEMPLATES]!.url![(p.language as Language) ?? "en"]} ↗
          </a>
        ) : null}
        <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-2">template · {row.template_name}</div>
      </>
    );
  } else if (kind === "image") {
    body = (
      <>
        <img src={`/files/${String(p.fileKey)}`} alt="" className="mb-1 w-48 rounded-[var(--radius-input)] bg-card" />
        {waText(String(p.caption ?? ""))}
      </>
    );
  } else if (kind === "document") {
    body = (
      <a href={`/files/${String(p.fileKey)}`} target="_blank" rel="noreferrer" className="underline">
        📄 {String(p.filename)}
      </a>
    );
  } else if (kind === "buttons") {
    body = waText(String(p.text ?? ""));
    buttons = (p.buttons as { id: string; title: string }[]) ?? [];
  } else if (kind === "list") {
    const menu = p.menu as WhatsAppMenu;
    body = (
      <>
        <b>{menu.header}</b>
        <div>{menu.body}</div>
      </>
    );
    buttons = menu.sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title })));
  } else {
    body = waText(String(p.text ?? ""));
  }

  return (
    <div className={`flex ${out ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-[var(--radius-card)] px-3 py-2 text-sm shadow-sm ${out ? "rounded-tl-sm bg-card" : "rounded-tr-sm bg-[#d9fdd3]"}`}>
        <div className="whitespace-pre-wrap break-words">{body}</div>
        {buttons.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {buttons.map((b) => (
              <ReplyButton key={b.id} phone={phone} id={b.id} title={b.title} />
            ))}
          </div>
        ) : null}
        <div className="mt-1 text-right text-[10px] text-muted">
          {new Date(row.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
          {row.status === "failed" ? " · failed" : ""}
        </div>
      </div>
    </div>
  );
}

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  if (!isDemo) notFound();
  const actor = await requireOwnerActor();
  const sp = await searchParams;
  const deps = await getDeps();
  const [tenants, payments] = await asCurrentUser(async (tx) => [await queries.listTenants(tx, actor.orgId), await queries.paymentsOverview(tx, actor.orgId)] as const);
  const phone = sp.phone && tenants.some((t) => t.phone === sp.phone) ? sp.phone : tenants[0]?.phone;
  const log = phone
    ? ((await deps.db.execute(sql`select id, direction, template_name, status, payload, created_at from message_log where phone = ${phone} order by created_at, id`)) as unknown as LogRow[] | { rows: LogRow[] })
    : [];
  const rows = Array.isArray(log) ? log : log.rows;
  const staffAlerts = (await deps.db.execute(
    sql`select l.id, l.direction, l.template_name, l.status, l.payload, l.created_at from message_log l
        join users u on u.phone = l.phone join org_members m on m.user_id = u.id and m.org_id = ${actor.orgId}
        where l.template_name = 'rf_staff_alert' order by l.created_at desc limit 5`,
  )) as unknown as LogRow[] | { rows: LogRow[] };
  const alerts = Array.isArray(staffAlerts) ? staffAlerts : staffAlerts.rows;
  const tenant = tenants.find((t) => t.phone === phone);

  return (
    <Page title="Demo tools" subtitle="Stand-ins for things that need real accounts: tenants' WhatsApp, your bank's alert emails, and the daily scheduler.">
      <AutoRefresh seconds={4} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Tenant's WhatsApp" description="Exactly what the tenant receives. Tap buttons or type as the tenant.">
          {tenants.length === 0 ? (
            <Empty>Add a tenant first.</Empty>
          ) : (
            <>
              <form method="get" className="mb-3 flex gap-2">
                <select name="phone" defaultValue={phone} className="h-10 flex-1 rounded-[var(--radius-input)] border border-line px-2 text-sm">
                  {tenants.map((t) => (
                    <option key={t.tenancyId} value={t.phone}>
                      {t.name} · {t.room}
                      {t.bed} · {formatPhone(t.phone)}
                    </option>
                  ))}
                </select>
                <button className="h-10 rounded-[var(--radius-input)] border border-line px-3 text-sm">Open</button>
              </form>
              <div className="rounded-[var(--radius-card)] bg-[#efeae2] p-3">
                <p className="mb-2 text-center text-xs text-ink-2">
                  {tenant?.name} · {phone ? formatPhone(phone) : ""} · chat with RentFlow
                </p>
                <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                  {rows.length === 0 ? <p className="text-center text-sm text-ink-2">No messages yet.</p> : rows.map((r) => <Bubble key={r.id} row={r} phone={phone ?? ""} />)}
                </div>
                <ActionForm action={tenantSendsAction} submit="Send" className="mt-3 flex gap-2" resetOnSuccess>
                  <input type="hidden" name="phone" value={phone} />
                  <input name="text" placeholder='Type e.g. "hi", "bill", "pay", or UTR digits' className="h-10 min-w-0 flex-1 rounded-full border border-line bg-card px-4 text-sm" />
                </ActionForm>
                <ActionForm action={tenantSendsAction} submit="Send photo" className="mt-2 flex items-center gap-2" variant="secondary" resetOnSuccess>
                  <input type="hidden" name="phone" value={phone} />
                  <input name="image" type="file" accept="image/*" required className="min-w-0 flex-1 text-xs file:mr-2 file:h-8 file:rounded-full file:border-0 file:bg-card file:px-3" />
                </ActionForm>
              </div>
            </>
          )}
        </Section>

        <div className="space-y-5">
          <Section title="Bank credit alert" description="Pretend money landed in your bank and the alert email was forwarded to RentFlow.">
            <ActionForm action={bankEmailAction} submit="Send bank alert">
              <div className="grid grid-cols-2 gap-3">
                <Select label="Bank" name="bank" defaultValue="hdfc">
                  {SUPPORTED_BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b.toUpperCase()}
                    </option>
                  ))}
                </Select>
                <Field label="Date" name="date" type="date" defaultValue={todayInIndia()} />
                <Field label="Amount (₹)" name="amount" inputMode="decimal" placeholder="2866.01" required />
                <Field label="UTR (optional)" name="utr" placeholder="random" />
                <Field label="Payer name" name="payer" placeholder="Anubhav Kumar" />
                <Field label="Payer UPI ID" name="vpa" placeholder="anubhav@okaxis" />
              </div>
              <Check label="Auto-forwarded and verified as from the bank (DKIM)" name="verified" defaultChecked />
              {payments.openBills.length > 0 ? (
                <div className="rounded-[var(--radius-input)] bg-page p-2 text-xs text-ink-2">
                  <p className="mb-1 font-medium">Amounts tenants are expected to pay (copy one for an automatic match):</p>
                  {payments.openBills.map((b) => (
                    <p key={b.billId}>
                      {b.label}: <b className="tabular-nums">{formatINR(b.payablePaise, { alwaysShowPaise: true }).replace("₹", "").replace(/,/g, "")}</b>
                    </p>
                  ))}
                </div>
              ) : null}
            </ActionForm>
          </Section>

          <Section title="Daily jobs" description="In production these run every morning at 9:00 IST. Pick a date to see what would happen — e.g. 2 days before the due date for a reminder.">
            <ActionForm action={dailyAction} submit="Run daily jobs">
              <Field label="As if today were" name="date" type="date" defaultValue={todayInIndia()} />
            </ActionForm>
          </Section>

          <Section title="Messages to staff" description="Alerts owners and managers get on WhatsApp.">
            {alerts.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="rounded-[var(--radius-input)] bg-page px-3 py-2">
                    {String(a.payload.text ?? "")}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </Page>
  );
}
