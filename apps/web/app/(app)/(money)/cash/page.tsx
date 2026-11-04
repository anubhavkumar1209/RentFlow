import { formatDate, formatINR, todayInIndia } from "@rentflow/core";
import { can, queries } from "@rentflow/server";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Field, Money, Page, Section, Select, Table, Td } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";
import { handOverAction, recordCashAction, resendAction } from "./actions";

export default async function CashPage() {
  const actor = await requireActor();
  const [tenants, cash] = await asCurrentUser(async (tx) => [await queries.listTenants(tx, actor.orgId), await queries.cashOverview(tx, actor.orgId)] as const);
  const allowed = tenants.filter((t) => can(actor, t.propertyId, "record_cash"));
  const owner = actor.role === "owner";

  return (
    <Page title="Cash" subtitle="Cash counts as paid only after the tenant confirms it on WhatsApp.">
      {allowed.length > 0 ? (
        <Section title="Record cash received">
          <ActionForm action={recordCashAction} submit="Record and ask tenant to confirm" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Tenant" name="tenancyId" defaultValue="">
                <option value="">Choose…</option>
                {allowed.map((t) => (
                  <option key={t.tenancyId} value={t.tenancyId}>
                    {t.room}
                    {t.bed} · {t.name}
                    {t.balancePaise > 0 ? ` (due ${formatINR(t.balancePaise)})` : ""}
                  </option>
                ))}
              </Select>
              <Field label="Amount (₹)" name="amount" inputMode="decimal" required />
              <Field label="Received on" name="receivedOn" type="date" defaultValue={todayInIndia()} />
            </div>
            <Field label="Note (optional)" name="note" />
          </ActionForm>
        </Section>
      ) : null}

      <Section title="Cash in hand" description="Confirmed by tenants and not yet handed over to the owner.">
        {cash.inHand.length === 0 ? (
          <Empty>No cash in hand.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {cash.inHand.map((c) => (
              <li key={c.manager} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{c.manager}</span>
                <span className="flex items-center gap-3">
                  <Money paise={c.amountPaise} className="font-semibold" />
                  {owner ? (
                    <ActionForm action={handOverAction} submit="Received from manager" inline variant="secondary" confirm="Mark this cash as handed over to you?">
                      <input type="hidden" name="ids" value={c.ids.join(",")} />
                    </ActionForm>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Cash entries">
        {cash.entries.length === 0 ? (
          <Empty>No cash recorded yet.</Empty>
        ) : (
          <Table head={["Date", "Tenant", "Amount", "By", "Status"]}>
            {cash.entries.map((e) => (
              <tr key={e.id}>
                <Td>{formatDate(e.received_on)}</Td>
                <Td>
                  {e.tenant} <span className="text-xs text-ink-2">{e.room}</span>
                </Td>
                <Td>
                  <Money paise={e.amountPaise} />
                </Td>
                <Td>{e.manager}</Td>
                <Td>
                  {e.disputed_at ? (
                    <Badge tone="red">tenant says not correct</Badge>
                  ) : e.tenant_confirmed_at ? (
                    <Badge tone="green">{e.handed_over_at ? "confirmed · handed over" : "confirmed"}</Badge>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Badge tone="amber">waiting for tenant</Badge>
                      <ActionForm action={resendAction} submit="Resend" inline variant="secondary">
                        <input type="hidden" name="id" value={e.id} />
                      </ActionForm>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </Page>
  );
}
