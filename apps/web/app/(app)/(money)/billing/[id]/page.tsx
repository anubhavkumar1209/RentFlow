import { addMonths, formatDate, formatPeriod, todayInIndia } from "@rentflow/core";
import { can, queries } from "@rentflow/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, LinkButton, Money, Page, Section, StatusBadge } from "@/components/ui";
import { asCurrentUser, ensureAccess, requireActor } from "@/lib/session";
import { addLineAction, approveAction, rebuildAction, removeLineAction } from "../actions";
import { TriangleAlert } from "lucide-react";

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const c = await asCurrentUser((tx) => queries.cycleDetail(tx, actor.orgId, id));
  if (!c) notFound();
  ensureAccess(can(actor, c.property_id));
  const owner = actor.role === "owner";
  const draft = c.status === "draft";
  const total = c.bills.reduce((s, b) => s + b.totalPaise, 0);

  return (
    <Page
      title={`${c.kind === "final" ? "Final bill" : "Bills"} · ${formatPeriod(c.period)}`}
      subtitle={
        <>
          {c.property_name} · due {formatDate(c.due_date)} · {c.bills.length} bill{c.bills.length === 1 ? "" : "s"} · <Money paise={total} /> <StatusBadge status={c.status} />
        </>
      }
      actions={
        draft && c.kind === "monthly" ? (
          <>
            <LinkButton href={`/readings?property=${c.property_id}&period=${addMonths(c.period, -1)}`} variant="secondary">
              Meter readings
            </LinkButton>
            <ActionForm action={rebuildAction} submit="Recalculate" variant="secondary" inline>
              <input type="hidden" name="propertyId" value={c.property_id} />
              <input type="hidden" name="period" value={c.period} />
            </ActionForm>
          </>
        ) : null
      }
    >
      {draft && c.anomalies.length > 0 ? (
        <Section title="Check before approving">
          <ul className="space-y-1 text-sm">
            {c.anomalies.map((a, i) => (
              <li key={i} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-2">Fix readings on the Meter readings page — the draft updates automatically. Or approve as is.</p>
        </Section>
      ) : null}

      {c.bills.map((b) => (
        <Section
          key={b.id}
          title={`${b.room}${b.bed} · ${b.tenantName}`}
          actions={
            <span className="flex items-center gap-2 text-sm">
              {b.payablePaise > 0 ? (
                <span>
                  To pay <b><Money paise={b.payablePaise} /></b>
                </span>
              ) : null}
              {!draft ? <StatusBadge status={b.status} /> : null}
              {!draft && b.sentAt ? <Badge tone="blue">WhatsApp sent</Badge> : null}
            </span>
          }
        >
          <ul className="divide-y divide-line text-sm">
            {b.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
                <span className={l.carried ? "text-ink-2" : ""}>
                  {l.description} {l.manual ? <Badge tone="blue">added</Badge> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Money paise={l.amountPaise} />
                  {draft && l.manual ? (
                    <ActionForm action={removeLineAction} submit="Remove" inline variant="secondary">
                      <input type="hidden" name="lineId" value={l.id} />
                    </ActionForm>
                  ) : null}
                </span>
              </li>
            ))}
            <li className="flex justify-between py-1.5 font-semibold">
              <span>Total</span>
              <Money paise={b.totalPaise} />
            </li>
          </ul>
          {draft ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Add a charge or discount</summary>
              <ActionForm action={addLineAction} submit="Add" className="mt-2 grid gap-2 sm:grid-cols-[9rem_1fr_8rem_auto] sm:items-end" resetOnSuccess>
                <input type="hidden" name="billId" value={b.id} />
                <select name="kind" className="h-11 rounded-[var(--radius-input)] border border-line px-2 text-sm">
                  <option value="service">Charge</option>
                  {owner ? <option value="adjustment">Discount / correction</option> : null}
                </select>
                <input name="description" placeholder="Laundry" className="h-11 rounded-[var(--radius-input)] border border-line px-3" required />
                <input name="amount" placeholder="90 or -100" inputMode="decimal" className="h-11 rounded-[var(--radius-input)] border border-line px-3" required />
              </ActionForm>
            </details>
          ) : null}
        </Section>
      ))}

      {draft ? (
        owner ? (
          <Section title="Approve">
            <p className="mb-3 text-sm text-ink-2">
              Approving locks these bills, gives each one a unique amount to pay (so payments match automatically), records the charges, and sends every tenant their bill with a payment QR on WhatsApp. Later changes become adjustments on next month&apos;s bill.
            </p>
            <ActionForm action={approveAction} submit={`Approve and send ${c.bills.length} bill${c.bills.length === 1 ? "" : "s"}`} confirm="Approve and lock these bills? They'll be sent on WhatsApp now.">
              <input type="hidden" name="cycleId" value={c.id} />
            </ActionForm>
          </Section>
        ) : (
          <p className="text-sm text-ink-2">The owner will review and approve these bills.</p>
        )
      ) : (
        <p className="text-sm text-ink-2">
          Approved {c.approved_at ? formatDate(todayInIndia(c.approved_at)) : ""}. This cycle is locked. <Link className="underline" href="/payments">See payments</Link>
        </p>
      )}
    </Page>
  );
}
