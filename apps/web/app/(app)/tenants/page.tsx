import { formatPhone } from "@rentflow/core";
import { queries } from "@rentflow/server";
import Link from "next/link";
import { Badge, Balance, Empty, LinkButton, Money, Page, Section, StatusBadge, Table, Td } from "@/components/ui";
import { selectedPropertyId } from "@/lib/property";
import { asCurrentUser, requireActor } from "@/lib/session";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ property?: string; q?: string; show?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const properties = await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId));
  // The filter starts from the top-bar property switcher; "All properties" in the filter overrides it.
  const property = sp.property ?? (await selectedPropertyId(properties.map((p) => p.id))) ?? "";
  const tenants = await asCurrentUser((tx) =>
    queries.listTenants(tx, actor.orgId, { propertyId: property || undefined, search: sp.q, status: sp.show === "closed" ? "closed" : "current" }),
  );

  return (
    <Page
      title="Tenants"
      subtitle={`${tenants.length} ${sp.show === "closed" ? "past" : "current"} tenant${tenants.length === 1 ? "" : "s"}`}
      actions={
        <>
          <LinkButton href="/tenants/import" variant="secondary">
            Import CSV / Excel
          </LinkButton>
          {actor.role === "owner" ? (
            <LinkButton href="/exports/tenants.csv" variant="secondary">
              Export
            </LinkButton>
          ) : null}
          <LinkButton href="/tenants/new">Add tenant</LinkButton>
        </>
      }
    >
      <Section>
        <form className="mb-3 flex flex-wrap gap-2" method="get">
          <select name="property" defaultValue={property} className="h-10 rounded-[var(--radius-input)] border border-line px-2 text-sm">
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="show" defaultValue={sp.show ?? ""} className="h-10 rounded-[var(--radius-input)] border border-line px-2 text-sm">
            <option value="">Current</option>
            <option value="closed">Moved out</option>
          </select>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, phone or room" className="h-10 min-w-0 flex-1 rounded-[var(--radius-input)] border border-line px-3 text-sm" />
          <button className="h-10 rounded-[var(--radius-input)] bg-ink px-4 text-sm font-medium text-white">Filter</button>
        </form>
        {tenants.length === 0 ? (
          <Empty>No tenants match.</Empty>
        ) : (
          <Table head={["Tenant", "Room", "Rent", "Balance", "Status"]}>
            {tenants.map((t) => (
              <tr key={t.tenancyId}>
                <Td>
                  <Link href={`/tenants/${t.tenancyId}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  <div className="text-xs text-ink-2">
                    {formatPhone(t.phone)} {!t.consented && t.status !== "closed" ? <Badge tone="amber">no WhatsApp consent yet</Badge> : null}
                  </div>
                </Td>
                <Td>
                  {t.room}
                  {t.bed} <div className="text-xs text-ink-2">{t.propertyName}</div>
                </Td>
                <Td>
                  <Money paise={t.rentPaise} />
                </Td>
                <Td>
                  <Balance paise={t.balancePaise} />
                </Td>
                <Td>
                  <StatusBadge status={t.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </Page>
  );
}
