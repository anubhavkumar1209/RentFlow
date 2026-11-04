import { formatPeriod, periodOf, todayInIndia } from "@rentflow/core";
import { queries } from "@rentflow/server";
import { LinkButton, Money, Page, Section, Table, Td } from "@/components/ui";
import { asCurrentUser, requireOwnerActor } from "@/lib/session";

export default async function ReportsPage() {
  const actor = await requireOwnerActor();
  const rows = await asCurrentUser((tx) => queries.collectionReport(tx, actor.orgId, periodOf(todayInIndia()), 12));
  const total = rows.reduce(
    (s, r) => ({ charged: s.charged + r.chargedPaise, upi: s.upi + r.upiPaise, cash: s.cash + r.cashPaise, deposit: s.deposit + r.depositPaise, collected: s.collected + r.collectedPaise }),
    { charged: 0, upi: 0, cash: 0, deposit: 0, collected: 0 },
  );
  return (
    <Page
      title="Reports"
      subtitle="Month-wise: what was billed and what came in, by how it was paid."
      actions={
        <>
          <LinkButton href="/exports/collections.csv" variant="secondary">
            CSV
          </LinkButton>
          <LinkButton href="/exports/rentflow.xlsx">Excel (all sheets)</LinkButton>
        </>
      }
    >
      <Section title="Collections, last 12 months">
        <Table head={["Month", "Billed", "UPI", "Cash", "From deposits", "Collected"]}>
          {[...rows].reverse().map((r) => (
            <tr key={r.period}>
              <Td>{formatPeriod(r.period)}</Td>
              <Td>
                <Money paise={r.chargedPaise} />
              </Td>
              <Td>
                <Money paise={r.upiPaise} />
              </Td>
              <Td>
                <Money paise={r.cashPaise} />
              </Td>
              <Td>
                <Money paise={r.depositPaise} />
              </Td>
              <Td className="font-semibold">
                <Money paise={r.collectedPaise} />
              </Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td>
              <Money paise={total.charged} />
            </Td>
            <Td>
              <Money paise={total.upi} />
            </Td>
            <Td>
              <Money paise={total.cash} />
            </Td>
            <Td>
              <Money paise={total.deposit} />
            </Td>
            <Td>
              <Money paise={total.collected} />
            </Td>
          </tr>
        </Table>
        <p className="mt-2 text-xs text-ink-2">Months are by the date money was recorded. Billed = new charges approved that month.</p>
      </Section>
    </Page>
  );
}
