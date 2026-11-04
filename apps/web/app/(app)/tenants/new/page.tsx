import { LanguageOptions } from "@/components/language-options";
import { formatINR, todayInIndia } from "@rentflow/core";
import { can, queries } from "@rentflow/server";
import { ActionForm } from "@/components/action-form";
import { Check, Empty, Field, Page, Section, Select } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";
import { addTenantAction } from "../actions";

export default async function NewTenantPage({ searchParams }: { searchParams: Promise<{ property?: string; bed?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const properties = (await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId))).filter((p) => can(actor, p.id, "manage_tenants"));
  const propertyId = sp.property && properties.some((p) => p.id === sp.property) ? sp.property : properties[0]?.id;
  const detail = propertyId ? await asCurrentUser((tx) => queries.propertyDetail(tx, actor.orgId, propertyId)) : null;
  const vacant = detail?.rooms.flatMap((r) => r.beds.filter((b) => b.status === "vacant").map((b) => ({ ...b, room: r.number }))) ?? [];

  return (
    <Page title="Add tenant" subtitle="They'll get a WhatsApp welcome and can reply to see their bill.">
      {properties.length > 1 ? (
        <form method="get" className="flex gap-2">
          <select name="property" defaultValue={propertyId} className="h-11 flex-1 rounded-[var(--radius-input)] border border-line px-3">
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="h-11 rounded-[var(--radius-input)] border border-line px-4 text-sm font-medium">Switch</button>
        </form>
      ) : null}
      <Section title={detail?.name ?? "No property"}>
        {!detail ? (
          <Empty>Add a property first.</Empty>
        ) : vacant.length === 0 ? (
          <Empty>No vacant beds in this property. Generate more rooms, or free up a bed.</Empty>
        ) : (
          <ActionForm action={addTenantAction} submit="Add tenant and send welcome">
            <input type="hidden" name="propertyId" value={detail.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Bed" name="bedId" defaultValue={sp.bed && vacant.some((b) => b.id === sp.bed) ? sp.bed : vacant[0]?.id} required>
                {vacant.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.room}
                    {b.label} · default rent {formatINR(b.rentPaise)}
                  </option>
                ))}
              </Select>
              <Field label="Full name" name="name" autoComplete="off" required />
              <Field label="WhatsApp number" name="phone" type="tel" inputMode="tel" placeholder="98765 43210" required />
              <Field label="Monthly rent (₹)" name="rent" inputMode="decimal" hint="Leave blank to use the bed's default rent." />
              <Field label="Deposit (₹)" name="deposit" inputMode="decimal" defaultValue="0" />
              <Field label="Check-in date" name="checkIn" type="date" defaultValue={todayInIndia()} required />
              <Field label="Guardian phone(s), optional" name="guardians" placeholder="98765 11111, 98765 22222" />
              <Select label="WhatsApp language" name="language" defaultValue="en">
                <LanguageOptions />
              </Select>
            </div>
            <Check label="Deposit already received" name="depositReceived" defaultChecked />
          </ActionForm>
        )}
      </Section>
    </Page>
  );
}
