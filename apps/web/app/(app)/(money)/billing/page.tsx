import { addMonths, formatDate, formatPeriod, periodOf, todayInIndia } from "@rentflow/core";
import { queries } from "@rentflow/server";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Money, Page, Section, Select, StatusBadge, Table, Td } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";
import { createDraftAction } from "./actions";

export default async function BillingPage() {
  const actor = await requireActor();
  const [cycles, properties] = await asCurrentUser(async (tx) => [await queries.listCycles(tx, actor.orgId), await queries.listProperties(tx, actor.orgId)] as const);
  const thisMonth = periodOf(todayInIndia());
  const months = [addMonths(thisMonth, 1), thisMonth, addMonths(thisMonth, -1)];

  return (
    <Page title="Billing" subtitle="Each month RentFlow drafts the bills a week before the due date. Review, then approve to lock and send.">
      <Section title="Draft a month now" description="Bills charge rent for that month and electricity used in the month before it.">
        {properties.length === 0 ? (
          <Empty>Add a property first.</Empty>
        ) : (
          <ActionForm action={createDraftAction} submit="Create / refresh draft" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Select label="Property" name="propertyId">
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select label="Month" name="period" defaultValue={thisMonth}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatPeriod(m)}
                </option>
              ))}
            </Select>
          </ActionForm>
        )}
      </Section>

      <Section title="Billing cycles">
        {cycles.length === 0 ? (
          <Empty>No cycles yet.</Empty>
        ) : (
          <Table head={["Month", "Property", "Bills", "Total", "Due", "Status"]}>
            {cycles.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/billing/${c.id}`} className="font-medium hover:underline">
                    {formatPeriod(c.period)}
                  </Link>
                  {c.kind === "final" ? <div className="text-xs text-ink-2">Final bill · {c.tenant_name}</div> : null}
                </Td>
                <Td>{c.property_name}</Td>
                <Td>{c.bills}</Td>
                <Td>
                  <Money paise={c.totalPaise} />
                </Td>
                <Td>{formatDate(c.due_date)}</Td>
                <Td>
                  <StatusBadge status={c.status} /> {c.status === "draft" && c.anomalyCount > 0 ? <Badge tone="amber">{c.anomalyCount} flags</Badge> : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </Page>
  );
}
