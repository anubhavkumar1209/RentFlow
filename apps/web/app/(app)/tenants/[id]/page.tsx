import { LanguageOptions } from "@/components/language-options";
import { formatDate, formatPeriod, formatPhone, paiseToUpiAmount, todayInIndia } from "@rentflow/core";
import { can, queries } from "@rentflow/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Balance, Empty, Field, LinkButton, Money, Page, Section, Select, StatusBadge, Table, Td } from "@/components/ui";
import { asCurrentUser, ensureAccess, requireActor } from "@/lib/session";
import {
  adjustmentAction,
  cancelNoticeAction,
  closeTenancyAction,
  depositReceivedAction,
  finalBillAction,
  manualSettleAction,
  noticeAction,
  recordCashAction,
  settleDepositAction,
  updateTenantAction,
} from "../actions";

const LEDGER_LABEL: Record<string, string> = {
  charge: "Bill",
  payment: "Payment",
  reversal: "Reversal",
  adjustment: "Adjustment",
  deposit_in: "Deposit received",
  deposit_out: "Deposit out",
};

const rupees = (p: number) => paiseToUpiAmount(p).replace(/\.00$/, "");

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { id } = await params;
  const { welcome } = await searchParams;
  const actor = await requireActor();
  const t = await asCurrentUser((tx) => queries.tenantDetail(tx, actor.orgId, id));
  if (!t) notFound();
  ensureAccess(can(actor, t.property_id));
  const owner = actor.role === "owner";
  const manage = can(actor, t.property_id, "manage_tenants");
  const settlement = t.settlement as { deposit_paise: number; applied_paise: number; refund_paise: number; still_owed_paise: number; confirmed_at: string | null; disputed_at: string | null } | null;

  return (
    <Page
      title={t.name}
      subtitle={
        <>
          {t.property_name} · Room {t.room}
          {t.bed} · {formatPhone(t.phone)} · since {formatDate(t.check_in)}
        </>
      }
      actions={owner ? <LinkButton href={`/exports/ledger.csv?tenancy=${t.tenancy_id}`} variant="secondary">Export ledger</LinkButton> : null}
    >
      {welcome ? <p className="rounded-[var(--radius-input)] bg-brand-50 px-4 py-3 text-sm text-brand-700">Tenant added. A WhatsApp welcome is on its way (they tap "I agree" to give consent).</p> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-line bg-card p-4">
          <p className="text-xs uppercase text-ink-2">Balance</p>
          <p className="mt-1 text-lg">
            <Balance paise={t.balancePaise} />
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-card p-4">
          <p className="text-xs uppercase text-ink-2">Rent</p>
          <p className="mt-1 text-lg font-semibold">
            <Money paise={t.rentPaise} />
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-card p-4">
          <p className="text-xs uppercase text-ink-2">Deposit held</p>
          <p className="mt-1 text-lg font-semibold">
            <Money paise={t.depositHeldPaise} />
          </p>
          {t.depositHeldPaise < t.depositPaise && t.status !== "closed" ? <p className="text-xs text-warning">agreed {rupees(t.depositPaise)}</p> : null}
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-card p-4">
          <p className="text-xs uppercase text-ink-2">Status</p>
          <p className="mt-1">
            <StatusBadge status={t.status} /> {t.consent_at ? <Badge tone="green">WhatsApp consent</Badge> : <Badge tone="amber">no consent yet</Badge>}
          </p>
          {t.check_out ? <p className="mt-1 text-xs text-ink-2">Leaving {formatDate(t.check_out)}</p> : null}
        </div>
      </div>

      {t.status !== "closed" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {can(actor, t.property_id, "record_cash") ? (
            <Section title="Record cash" description="The tenant confirms on WhatsApp; only then it counts as paid and a receipt is sent.">
              <ActionForm action={recordCashAction} submit="Record cash" resetOnSuccess>
                <input type="hidden" name="tenancyId" value={t.tenancy_id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount (₹)" name="amount" inputMode="decimal" required />
                  <Field label="Received on" name="receivedOn" type="date" defaultValue={todayInIndia()} />
                </div>
                <Field label="Note (optional)" name="note" />
              </ActionForm>
            </Section>
          ) : null}
          {owner ? (
            <Section title="Payment received another way" description="UPI/bank money that RentFlow didn't see. Settles now and sends a receipt.">
              <ActionForm action={manualSettleAction} submit="Record payment" resetOnSuccess confirm="Record this payment and send a receipt?">
                <input type="hidden" name="tenancyId" value={t.tenancy_id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount (₹)" name="amount" inputMode="decimal" required />
                  <Field label="UTR / reference (optional)" name="utr" />
                  <Field label="Received on" name="receivedOn" type="date" defaultValue={todayInIndia()} />
                  <Field label="Note" name="note" />
                </div>
              </ActionForm>
            </Section>
          ) : null}
        </div>
      ) : null}

      <Section title="Bills">
        {t.bills.length === 0 ? (
          <Empty>No bills yet.</Empty>
        ) : (
          <Table head={["Month", "Total", "To pay", "Due", "Status"]}>
            {t.bills.map((b) => (
              <tr key={b.id}>
                <Td>
                  <Link className="font-medium hover:underline" href={`/billing/${b.cycleId}`}>
                    {formatPeriod(b.period)} {b.kind === "final" ? "(final)" : ""}
                  </Link>
                </Td>
                <Td>
                  <Money paise={b.totalPaise} />
                </Td>
                <Td>{b.payablePaise ? <Money paise={b.payablePaise} /> : "—"}</Td>
                <Td>{formatDate(b.dueDate)}</Td>
                <Td>
                  <StatusBadge status={b.cycleStatus === "draft" ? "draft" : b.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Ledger" description="Every rupee, newest first. Charges add to the balance, payments reduce it. Nothing here is ever edited — mistakes are fixed with adjustments.">
        {t.ledger.length === 0 ? (
          <Empty>No entries yet.</Empty>
        ) : (
          <Table head={["Date", "Entry", "Amount", "Balance"]}>
            {t.ledger.map((e) => (
              <tr key={e.id}>
                <Td>{formatDate(todayInIndia(e.createdAt))}</Td>
                <Td>
                  {LEDGER_LABEL[e.type] ?? e.type}
                  {e.note ? <div className="text-xs text-ink-2">{e.note}</div> : null}
                </Td>
                <Td>
                  <Money paise={e.amountPaise} />
                </Td>
                <Td>{e.isDeposit ? <span className="text-xs text-muted">deposit</span> : <Money paise={e.balancePaise} />}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Receipts">
        {t.receipts.length === 0 ? (
          <Empty>No receipts yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {t.receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{r.number}</b> · {formatDate(todayInIndia(r.createdAt))} · {r.cash ? "Cash" : "UPI"}
                </span>
                <span className="flex items-center gap-3">
                  <Money paise={r.amountPaise} className="font-semibold" />
                  {r.pdfRef ? (
                    <a className="text-brand-700 underline" href={`/files/${r.pdfRef}`} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    <span className="text-xs text-muted">generating…</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {manage ? (
        <Section title="Details">
          <ActionForm action={updateTenantAction} submit="Save details">
            <input type="hidden" name="tenancyId" value={t.tenancy_id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" name="name" defaultValue={t.name} required />
              <Field label="Guardian phone(s)" name="guardians" defaultValue={t.guardian_phones.join(", ")} />
              <Field label="Monthly rent (₹)" name="rent" inputMode="decimal" defaultValue={rupees(t.rentPaise)} disabled={!can(actor, t.property_id, "edit_prices")} />
              <Field label="Agreed deposit (₹)" name="deposit" inputMode="decimal" defaultValue={rupees(t.depositPaise)} disabled={!can(actor, t.property_id, "edit_prices")} />
              <Select label="WhatsApp language" name="language" defaultValue={t.language}>
                <LanguageOptions />
              </Select>
            </div>
            {!can(actor, t.property_id, "edit_prices") ? (
              <>
                <input type="hidden" name="rent" value={rupees(t.rentPaise)} />
                <input type="hidden" name="deposit" value={rupees(t.depositPaise)} />
              </>
            ) : null}
          </ActionForm>
        </Section>
      ) : null}

      {owner && t.status !== "closed" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Adjustment" description="A correction after a bill was approved (e.g. refund for a Wi-Fi outage: -100). Shows on the next bill.">
            <ActionForm action={adjustmentAction} submit="Add adjustment" resetOnSuccess>
              <input type="hidden" name="tenancyId" value={t.tenancy_id} />
              <div className="grid grid-cols-[8rem_1fr] gap-3">
                <Field label="Amount (₹)" name="amount" placeholder="-100" required />
                <Field label="Reason" name="description" required />
              </div>
            </ActionForm>
          </Section>
          <Section title="Deposit received later" description="If the deposit wasn't collected at check-in.">
            <ActionForm action={depositReceivedAction} submit="Record deposit" resetOnSuccess>
              <input type="hidden" name="tenancyId" value={t.tenancy_id} />
              <Field label="Amount (₹)" name="amount" inputMode="decimal" defaultValue={rupees(Math.max(0, t.depositPaise - t.depositHeldPaise))} required />
            </ActionForm>
          </Section>
        </div>
      ) : null}

      {manage && t.status !== "closed" ? (
        <Section title="Moving out" description="Notice → final bill (owner approves it in Billing) → deposit settlement → tenant confirms the refund on WhatsApp → bed becomes vacant.">
          <div className="space-y-5">
            {t.status === "active" ? (
              <ActionForm action={noticeAction} submit="Record notice">
                <input type="hidden" name="tenancyId" value={t.tenancy_id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Notice given on" name="noticeDate" type="date" defaultValue={todayInIndia()} required />
                  <Field label="Check-out date" name="checkOut" type="date" required />
                </div>
              </ActionForm>
            ) : null}

            {t.status === "notice" && (!t.finalCycle || t.finalCycle.status === "draft") ? (
              <>
                <ActionForm action={finalBillAction} submit={t.finalCycle ? "Redo final bill" : "Prepare final bill"}>
                  <input type="hidden" name="tenancyId" value={t.tenancy_id} />
                  <p className="text-sm text-ink-2">Rent up to {t.check_out ? formatDate(t.check_out) : "check-out"}, this tenant&apos;s share of electricity up to the final reading, dues, and any damages.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Final meter reading (units)" name="finalReading" type="number" min={0} disabled={!t.meter_id} hint={t.meter_id ? "Leave blank to skip electricity." : "This room has no meter."} />
                    <Field label="Meter photo" name="photo" type="file" accept="image/*" capture="environment" />
                  </div>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="grid grid-cols-[1fr_8rem] gap-3">
                      <Field label={i === 0 ? "Damage / deduction (optional)" : ""} aria-label="Damage" name={`damage_${i}`} placeholder={i === 0 ? "Broken chair" : ""} />
                      <Field label={i === 0 ? "Amount (₹)" : ""} aria-label="Amount" name={`damageAmount_${i}`} inputMode="decimal" />
                    </div>
                  ))}
                </ActionForm>
                <ActionForm action={cancelNoticeAction} submit="Cancel notice (tenant is staying)" variant="secondary" confirm="Cancel the notice?">
                  <input type="hidden" name="tenancyId" value={t.tenancy_id} />
                </ActionForm>
              </>
            ) : null}

            {t.finalCycle && t.finalCycle.status !== "draft" && !settlement && owner ? (
              <ActionForm action={settleDepositAction} submit="Settle deposit" confirm="Use the deposit against dues and refund the rest?">
                <input type="hidden" name="tenancyId" value={t.tenancy_id} />
                <p className="text-sm">
                  Final bill approved. Deposit held <Money paise={t.depositHeldPaise} />, balance <Balance paise={t.balancePaise} />.
                </p>
              </ActionForm>
            ) : null}

            {settlement ? (
              <div className="rounded-[var(--radius-input)] bg-page p-3 text-sm">
                <p>
                  Deposit <Money paise={settlement.deposit_paise} /> · used for dues <Money paise={settlement.applied_paise} /> · refund <b><Money paise={settlement.refund_paise} /></b>
                </p>
                <p className="mt-1">
                  {settlement.confirmed_at ? "Tenant confirmed the refund." : settlement.disputed_at ? "Tenant says they did NOT receive the refund." : settlement.refund_paise > 0 ? "Waiting for the tenant to confirm the refund on WhatsApp." : ""}
                </p>
              </div>
            ) : null}

            {owner ? (
              <ActionForm action={closeTenancyAction} submit="Close stay now" variant="danger" confirm="Close this stay and free the bed? Do this only if the tenant has left and everything is settled.">
                <input type="hidden" name="tenancyId" value={t.tenancy_id} />
              </ActionForm>
            ) : null}
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
