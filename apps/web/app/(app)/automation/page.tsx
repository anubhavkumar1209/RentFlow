import { formatDate, formatHour, formatINR, formatPeriod, formatUpiPhone, type AutomationKey } from "@rentflow/core";
import { automationOverview, isOwner, queries } from "@rentflow/server";
import { Alert, Chip, cn, type Tone } from "@rentflow/ui";
import { BadgeCheck, CircleDollarSign, Hourglass, Landmark, MessageCircle, Pause, Play, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Empty, LinkButton, Page, Section, Table, Td } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { selectedPropertyId } from "@/lib/property";
import { asCurrentUser, requireActor } from "@/lib/session";
import { pauseAutomationsAction, resumeAutomationsAction, retryMessageAction } from "./actions";
import { AutomationCard } from "./automation-card";

const CARDS: { key: AutomationKey; title: string; description: string }[] = [
  { key: "bill", title: "Monthly bill", description: "Drafts every tenant's bill with rent, electricity and charges, and sends it with the amount, due date, UPI details, QR and a Pay now button." },
  { key: "reminder_before", title: "Reminder before the due date", description: "A friendly heads-up to tenants who haven't paid yet." },
  { key: "reminder_due", title: "Due-day reminder", description: "On the due date, only to tenants who still owe." },
  { key: "reminder_overdue", title: "Late-payment notices", description: "After the due date, with the amount still left. Stops the moment they pay." },
  { key: "payment_confirmation", title: "Payment confirmation", description: "\"Payment received\" with the PDF receipt, once the money is confirmed." },
];
const LABEL: Record<AutomationKey, string> = {
  bill: "Monthly bill",
  reminder_before: "Reminder",
  reminder_due: "Due-day reminder",
  reminder_overdue: "Late-payment notice",
  payment_confirmation: "Payment confirmation",
};
const MESSAGE_TONE: Record<string, Tone> = { sent: "info", delivered: "success", read: "success", failed: "danger", retried: "neutral" };

function ordinal(d: number): string {
  return d === 1 ? "1st" : d === 2 ? "2nd" : d === 3 ? "3rd" : `${d}th`;
}

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const actor = await requireActor();
  if (!isOwner(actor)) redirect("/dashboard");
  const properties = await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId));
  if (properties.length === 0) {
    return (
      <Page title="WhatsApp Automation">
        <Empty action={<LinkButton href="/properties">Add your PG</LinkButton>}>Add a PG first. Then set when bills, reminders and receipts go out.</Empty>
      </Page>
    );
  }
  const ids = properties.map((p) => p.id);
  const { p: wanted } = await searchParams;
  const propertyId = (wanted && ids.includes(wanted) ? wanted : await selectedPropertyId(ids)) ?? ids[0]!;
  const o = await automationOverview(await getDeps(), actor, propertyId);
  const a = o.automations;
  const bill = a.bill.schedule;
  const nextBill = o.nextBill
    ? `Next bills: ${formatDate(o.nextBill.date)}, ${formatHour(bill.hour)} (${formatPeriod(o.nextBill.period)})${bill.approveFirst ? " · waits for your approval" : ""}`
    : undefined;
  const reminderDays = [
    a.reminder_before.enabled ? `${a.reminder_before.schedule.daysBefore} day${a.reminder_before.schedule.daysBefore === 1 ? "" : "s"} before` : null,
    a.reminder_due.enabled ? "on the due date" : null,
    a.reminder_overdue.enabled ? `${a.reminder_overdue.schedule.daysAfter.map((d) => `+${d}`).join(", ")}${a.reminder_overdue.schedule.weekly ? ", then weekly" : ""}` : null,
  ].filter(Boolean);
  const c = o.cycle;
  const upiPhone = formatUpiPhone(o.property.upiPhone);

  return (
    <Page
      title="WhatsApp Automation"
      subtitle="Bills, reminders and receipts go out on their own, at the times you choose. You stay in control."
      actions={
        o.property.paused && !o.property.propertyPaused ? (
          <ActionForm action={resumeAutomationsAction} submit="Resume all" inline>
            <input type="hidden" name="propertyId" value={propertyId} />
          </ActionForm>
        ) : !o.property.propertyPaused ? (
          <ActionForm action={pauseAutomationsAction} submit="Pause all" variant="secondary" inline confirm={`Nothing will go out on WhatsApp for ${o.property.name}: no bills, reminders or payment confirmations. Approved bills wait and are sent when you resume.`}>
            <input type="hidden" name="propertyId" value={propertyId} />
          </ActionForm>
        ) : null
      }
    >
      {properties.length > 1 ? (
        <nav aria-label="PG" className="flex flex-wrap gap-2">
          {properties.map((p) => (
            <Link key={p.id} href={`/automation?p=${p.id}`} className={cn("inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium", p.id === propertyId ? "border-primary bg-primary-soft text-primary" : "border-line bg-card text-ink-2 hover:text-ink")}>
              {p.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {/* Status banner */}
      <div className={cn("flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border p-4 md:p-5", o.property.paused ? "border-warning/30 bg-warning-soft" : "border-primary/20 bg-primary-soft")}>
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-white", o.property.paused ? "bg-warning" : "bg-primary")}>
          {o.property.paused ? <Pause className="size-5" /> : <Play className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            {o.property.name} · {o.property.propertyPaused ? "PG is paused" : o.property.paused ? "Automations paused" : "Automations running"}
          </p>
          <p className="text-sm text-ink-2">
            {o.property.propertyPaused
              ? "This PG is paused in My PGs, so no bills or reminders go out."
              : o.property.paused
                ? "Nothing goes out on WhatsApp until you resume. Approved bills and receipts wait and go out then."
                : [nextBill ?? "Bills: when you draft and approve them", reminderDays.length ? `Reminders: ${reminderDays.join(", ")}` : "Reminders: off"].join(" · ")}
          </p>
        </div>
        <p className="flex w-full items-center gap-1.5 text-xs text-ink-2 sm:w-auto">
          <MessageCircle className="size-3.5 shrink-0" /> Sent from RentFlow&apos;s WhatsApp number, as {o.property.name}
        </p>
      </div>

      {/* This month */}
      <Section title={c ? `${formatPeriod(c.period)} at a glance` : "This month at a glance"} description={c ? `Due ${formatDate(c.dueDate)}. Paid means the money is confirmed, never just a screenshot.` : undefined}>
        {c ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { icon: Send, label: "Bills sent", value: `${c.sent} of ${c.bills}`, sub: c.status === "draft" ? "Waiting for your approval" : c.sent < c.bills ? "Some are waiting" : "All sent on WhatsApp", tone: "text-ink" },
              { icon: BadgeCheck, label: "Paid", value: String(c.paid.count), sub: formatINR(c.paid.paise), tone: "text-success" },
              { icon: Hourglass, label: "Part paid / confirming", value: String(c.partial.count + c.confirming), sub: c.partial.count ? `${formatINR(c.partial.paise)} still to come` : "Screenshots waiting for the bank", tone: "text-warning" },
              { icon: CircleDollarSign, label: "Not paid yet", value: String(c.unpaid.count), sub: formatINR(c.unpaid.paise), tone: c.unpaid.count ? "text-danger" : "text-ink" },
            ].map((s) => (
              <div key={s.label} className="rounded-[var(--radius-card)] border border-line bg-card p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-2">
                  <s.icon className="size-4" strokeWidth={1.75} /> {s.label}
                </p>
                <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", s.tone)}>{s.value}</p>
                <p className="text-sm text-ink-2">{s.sub}</p>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No bills yet. {nextBill ? `${nextBill}.` : "Draft a month in Bills & Payments."}</Empty>
        )}
        {c ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href={c.status === "draft" ? `/billing/${c.id}` : "/payments"} variant="secondary">
              {c.status === "draft" ? "Review & approve bills" : "Open payments"}
            </LinkButton>
          </div>
        ) : null}
      </Section>

      {/* Where tenants pay */}
      <Section title="Where tenants pay" description="Shown on every bill and on the pay page. Money goes straight to your bank; RentFlow never holds it.">
        {o.property.upiVpa ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              ["UPI ID", o.property.upiVpa],
              ["Payee name", o.property.payeeName],
              ["UPI number", upiPhone ?? "Not added"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-input)] bg-page p-3">
                <dt className="text-xs text-ink-2">{label}</dt>
                <dd className={cn("mt-0.5 font-medium", value === "Not added" ? "text-ink-2" : "text-ink")}>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Alert tone="warning">No UPI ID yet, so bills go out without a QR code or Pay now button. Add it in your PG&apos;s settings.</Alert>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link href={`/properties/${propertyId}`} className="font-semibold text-primary hover:underline">
            Edit payment details
          </Link>
          <span className="flex items-center gap-1.5 text-ink-2">
            <ShieldCheck className="size-4 text-primary" /> A bill turns paid only after your bank alert matches, or you or your manager confirm it.
          </span>
        </div>
      </Section>

      {/* The automations */}
      <section aria-label="Automations" className="space-y-4">
        {CARDS.map((card) => (
          <AutomationCard
            key={card.key}
            propertyId={propertyId}
            automationKey={card.key}
            title={card.title}
            description={card.description}
            enabled={a[card.key].enabled}
            note={a[card.key].note}
            schedule={a[card.key].schedule as unknown as Record<string, unknown>}
            health={o.property.paused && a[card.key].enabled ? "paused" : o.health[card.key]}
            counts={o.counts[card.key]}
            template={card.key === "bill" ? "rf_bill" : card.key === "payment_confirmation" ? "rf_payment_received" : "rf_reminder"}
            previewVars={o.previewVars[card.key]}
            next={
              card.key === "bill"
                ? bill.mode === "day"
                  ? `Every month on the ${ordinal(bill.day)}, ${formatHour(bill.hour)}`
                  : `${bill.daysBefore} day${bill.daysBefore === 1 ? "" : "s"} before the due date (the ${ordinal(o.property.dueDay)}), ${formatHour(bill.hour)}`
                : card.key === "payment_confirmation"
                  ? "Right after each confirmed payment"
                  : undefined
            }
          />
        ))}
      </section>

      {/* Delivery log */}
      <Section title="Recent messages" description="Every automated message and what happened to it. Failed ones can be sent again.">
        {o.recent.length === 0 ? (
          <Empty icon={<Landmark className="size-5" />}>Nothing sent yet. Messages appear here as bills, reminders and receipts go out.</Empty>
        ) : (
          <Table head={["When", "Tenant", "Message", "Status", ""]}>
            {o.recent.map((m) => (
              <tr key={m.id}>
                <Td data-label="When">{new Date(m.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</Td>
                <Td data-label="Tenant">
                  <span className="font-medium">{m.tenant}</span> <span className="text-ink-2">· {m.room}</span>
                </Td>
                <Td data-label="Message">{m.automation ? LABEL[m.automation] : m.template}</Td>
                <Td data-label="Status">
                  <Chip tone={MESSAGE_TONE[m.status] ?? "neutral"}>{m.status === "retried" ? "Sent again" : m.status[0]!.toUpperCase() + m.status.slice(1)}</Chip>
                  {m.error ? <span className="mt-1 block text-xs text-danger">{m.error}</span> : null}
                </Td>
                <Td>
                  {m.status === "failed" ? (
                    <ActionForm action={retryMessageAction} submit="Retry" variant="secondary" inline>
                      <input type="hidden" name="logId" value={m.id} />
                    </ActionForm>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </Page>
  );
}
