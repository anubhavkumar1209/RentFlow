import { formatDate, formatINR, SUPPORTED_BANKS, todayInIndia } from "@rentflow/core";
import { queries } from "@rentflow/server";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Field, Money, Page, Section, Table, Td } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { asCurrentUser, requireOwnerActor } from "@/lib/session";
import { addFromEmailAction, confirmMatchAction, ignoreCreditAction, ignoreEmailAction } from "./actions";

const REASON: Record<string, string> = {
  payer_alias: "same payer as before",
  close_amount: "amount is close",
  exact_amount_unverified_sender: "exact amount, but the email wasn't verified as from the bank",
};

export default async function PaymentsPage() {
  const actor = await requireOwnerActor();
  const deps = await getDeps();
  const p = await asCurrentUser((tx) => queries.paymentsOverview(tx, actor.orgId));
  const slug = p.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "pg";
  const address = `${slug}-${p.inboundToken}@${deps.config.inboundDomain}`;

  return (
    <Page title="Payments" subtitle="Bank credits are matched to bills automatically. Anything RentFlow isn't sure about waits here for one tap from you.">
      <Section title="Unmatched payments" description="Money that reached your bank but isn't linked to a bill yet.">
        {p.unmatched.length === 0 ? (
          <Empty>Nothing to match.</Empty>
        ) : (
          <div className="space-y-3">
            {p.unmatched.map((c) => (
              <div key={c.id} className="rounded-[var(--radius-input)] border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold">
                    <Money paise={c.amountPaise} />
                  </p>
                  <p className="text-sm text-ink-2">
                    {formatDate(c.creditedOn)} {c.utr ? `· UTR ${c.utr}` : ""} {c.payer ? `· ${c.payer}` : ""} {c.verified ? null : <Badge tone="amber">{c.source === "manual" ? "typed by hand" : "unverified sender"}</Badge>}
                  </p>
                </div>
                {c.suggestions.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {c.suggestions.map((s) => (
                      <ActionForm key={s.billId} action={confirmMatchAction} submit={`Confirm: ${s.label}`} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="creditId" value={c.id} />
                        <input type="hidden" name="billId" value={s.billId} />
                        <span className="text-xs text-ink-2">Suggested: {REASON[s.reason] ?? s.reason}</span>
                      </ActionForm>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <ActionForm action={confirmMatchAction} submit="Match" variant="secondary" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="creditId" value={c.id} />
                    <select name="billId" className="h-11 rounded-[var(--radius-input)] border border-line px-2 text-sm" defaultValue="">
                      <option value="">Match to tenant…</option>
                      {p.openBills.map((b) => (
                        <option key={b.billId} value={b.billId}>
                          {b.label} · due {formatINR(b.outstandingPaise)}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                  <ActionForm action={ignoreCreditAction} submit="Not rent — ignore" variant="secondary" confirm="Ignore this credit? It won't be matched to anyone.">
                    <input type="hidden" name="creditId" value={c.id} />
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Payment screenshots waiting for money" description="A screenshot is never treated as payment. These are matched when the bank credit arrives; after 48 hours without money, you and the tenant are told.">
        {p.claims.length === 0 ? (
          <Empty>No screenshots waiting.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {p.claims.map((c) => (
              <a key={c.id} href={`/files/${c.screenshot_ref}`} target="_blank" rel="noreferrer" className="block rounded-[var(--radius-input)] border border-line p-2 text-xs hover:bg-page">
                <img src={`/files/${c.screenshot_ref}`} alt="" className="mb-1 aspect-[3/4] w-full rounded-[var(--radius-input)] bg-page object-cover" />
                <p className="font-medium">{c.tenant}</p>
                <p className="text-ink-2">
                  {formatDate(todayInIndia(c.created_at))} {c.utr_last4 ? `· UTR …${c.utr_last4}` : ""}
                </p>
                {c.flagged_at ? <Badge tone="red">no money after 48h</Badge> : null}
              </a>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recently matched">
        {p.matched.length === 0 ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <Table head={["When", "Tenant", "Amount", "How", "Receipt"]}>
            {p.matched.map((m) => (
              <tr key={m.id}>
                <Td>{formatDate(todayInIndia(m.created_at))}</Td>
                <Td>
                  {m.tenant} <span className="text-xs text-ink-2">{m.room}</span>
                </Td>
                <Td>
                  <Money paise={m.amountPaise} />
                </Td>
                <Td>
                  <Badge tone={m.method === "manual" ? "gray" : "green"}>{m.method === "unique_amount" ? "auto · exact amount" : m.method === "utr_last4" ? "auto · UTR digits" : "confirmed by you"}</Badge>
                </Td>
                <Td>{m.receipt_number ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section id="unparsed" title="Emails RentFlow couldn't read" description="Forwarded emails that didn't look like a credit alert from a bank we support. If one is a payment, type in the details.">
        {p.unparsed.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <div className="space-y-3">
            {p.unparsed.map((e) => (
              <details key={e.id} className="rounded-[var(--radius-input)] border border-line p-3">
                <summary className="cursor-pointer text-sm">
                  <b>{e.subject || "(no subject)"}</b> · {e.from_address}
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-[var(--radius-input)] bg-page p-2 text-xs">{e.body_text}</pre>
                <ActionForm action={addFromEmailAction} submit="Add as payment" className="mt-2 grid gap-2 sm:grid-cols-4 sm:items-end">
                  <input type="hidden" name="emailId" value={e.id} />
                  <Field label="Amount (₹)" name="amount" inputMode="decimal" required />
                  <Field label="UTR" name="utr" />
                  <Field label="Payer" name="payer" />
                  <Field label="Date" name="date" type="date" />
                </ActionForm>
                <div className="mt-2">
                  <ActionForm action={ignoreEmailAction} submit="Not a payment" variant="secondary">
                    <input type="hidden" name="emailId" value={e.id} />
                  </ActionForm>
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>

      <Section id="connect" title="Connect your bank alerts" description="So RentFlow sees payments the moment they land.">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            In the email account that gets your bank&apos;s credit alerts, create a filter for alerts from your bank and <b>auto-forward</b> them to:
            <code className="mt-1 block break-all rounded-[var(--radius-input)] bg-page px-2 py-1">{address}</code>
          </li>
          <li>Use automatic forwarding, not &quot;Fwd:&quot; by hand — only auto-forwarded alerts can be verified as really from the bank and settle bills on their own.</li>
          <li>Supported today: {SUPPORTED_BANKS.map((b) => b.toUpperCase()).join(", ")}. Other banks land under &quot;couldn&apos;t read&quot; until we add them.</li>
        </ol>
      </Section>
    </Page>
  );
}
