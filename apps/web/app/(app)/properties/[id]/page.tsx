import { paiseToUpiAmount } from "@rentflow/core";
import { can, queries } from "@rentflow/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Check, Empty, Field, LinkButton, Money, Page, Section } from "@/components/ui";
import { asCurrentUser, ensureAccess, requireActor } from "@/lib/session";
import { generateRoomsAction, setChargesAction, updateBedAction, updatePropertyAction } from "../actions";
import { PropertyFields } from "../property-fields";

const BED_STYLE: Record<string, string> = {
  vacant: "border-line bg-card text-ink-2",
  occupied: "border-success bg-success-soft text-success",
  notice: "border-warning bg-warning-soft text-warning",
  blocked: "border-danger bg-danger-soft text-danger",
};

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params;
  const { new: isNew } = await searchParams;
  const actor = await requireActor();
  ensureAccess(can(actor, id));
  const p = await asCurrentUser((tx) => queries.propertyDetail(tx, actor.orgId, id));
  if (!p) notFound();
  const owner = actor.role === "owner";
  const beds = p.rooms.flatMap((r) => r.beds);
  const vacant = beds.filter((b) => b.status === "vacant").length;
  const chargeRows = [...p.charges, { id: "", name: "", amountPaise: 0, active: true }, { id: "", name: "", amountPaise: 0, active: true }];

  return (
    <Page
      title={p.name}
      subtitle={`${p.rooms.length} rooms · ${beds.length} beds · ${vacant} vacant`}
      actions={<LinkButton href={`/tenants/new?property=${p.id}`}>Add tenant</LinkButton>}
    >
      {isNew ? (
        <p className="rounded-[var(--radius-input)] bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Property added. Next: set fixed charges (Wi-Fi, maintenance), then generate rooms and beds below.
        </p>
      ) : null}

      <Section title="Rooms and beds" description="Tap a bed to see its tenant. Green = occupied, amber = on notice, red = blocked.">
        {p.rooms.length === 0 ? (
          <Empty>No rooms yet. Use the generator below.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {p.rooms.map((room) => (
              <div key={room.id} className="rounded-[var(--radius-input)] border border-line p-2">
                <p className="mb-1 text-sm font-semibold">
                  {room.number} <span className="font-normal text-muted">· {room.sharing}-sharing</span>
                </p>
                <div className="grid gap-1">
                  {room.beds.map((b) => {
                    const inner = (
                      <>
                        <span className="font-semibold">{b.label}</span> <span className="truncate">{b.tenantName ?? (b.status === "blocked" ? "Blocked" : "Vacant")}</span>
                      </>
                    );
                    return b.tenancyId ? (
                      <Link key={b.id} href={`/tenants/${b.tenancyId}`} className={`flex min-h-9 items-center gap-1 rounded-[var(--radius-input)] border px-2 text-xs ${BED_STYLE[b.status]}`}>
                        {inner}
                      </Link>
                    ) : (
                      <Link key={b.id} href={`/tenants/new?property=${p.id}&bed=${b.id}`} className={`flex min-h-9 items-center gap-1 rounded-[var(--radius-input)] border px-2 text-xs ${BED_STYLE[b.status]}`}>
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {owner ? (
        <Section title="Generate rooms and beds" description='For example "floors 1–3, 10 rooms each, 2-sharing" makes 101–110, 201–210, 301–310 with beds A and B. Each room gets its own electricity meter.'>
          <ActionForm action={generateRoomsAction} submit="Generate rooms">
            <input type="hidden" name="propertyId" value={p.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <Field label="From floor" name="floorFrom" type="number" min={0} defaultValue={1} hint="0 = ground" />
              <Field label="To floor" name="floorTo" type="number" min={0} defaultValue={1} />
              <Field label="Rooms per floor" name="roomsPerFloor" type="number" min={1} defaultValue={10} />
              <Field label="First room no." name="startAt" type="number" min={1} defaultValue={1} hint="1 → 101" />
              <Field label="Beds per room" name="sharing" type="number" min={1} max={26} defaultValue={2} />
              <Field label="Rent per bed (₹)" name="rent" inputMode="decimal" placeholder="6000" required />
            </div>
          </ActionForm>
        </Section>
      ) : null}

      <Section title="Fixed monthly charges" description="Added to every tenant's bill, e.g. Wi-Fi ₹200. Electricity is charged separately from meter readings.">
        <ActionForm action={setChargesAction} submit="Save charges">
          <input type="hidden" name="propertyId" value={p.id} />
          <div className="space-y-2">
            {chargeRows.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <input type="hidden" name={`id_${i}`} value={c.id} />
                <Field label={i === 0 ? "Charge" : ""} aria-label="Charge name" name={`name_${i}`} defaultValue={c.name} placeholder="Wi-Fi" />
                <Field label={i === 0 ? "Amount (₹)" : ""} aria-label="Amount" name={`amount_${i}`} inputMode="decimal" defaultValue={c.amountPaise ? paiseToUpiAmount(c.amountPaise).replace(/\.00$/, "") : ""} />
                <Check label="On" name={`active_${i}`} defaultChecked={c.active} />
              </div>
            ))}
          </div>
        </ActionForm>
      </Section>

      {owner ? (
        <Section title="Settings">
          <ActionForm action={updatePropertyAction} submit="Save settings">
            <input type="hidden" name="propertyId" value={p.id} />
            <PropertyFields p={p} />
          </ActionForm>
        </Section>
      ) : null}

      {owner && beds.length > 0 ? (
        <Section title="Bed rents and blocking" description="Default rent is used when you add a tenant to that bed. Block a bed under repair so it isn't offered.">
          <div className="grid gap-2 sm:grid-cols-2">
            {p.rooms.flatMap((room) =>
              room.beds.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-input)] border border-line px-3 py-2 text-sm">
                  <span className="w-14 font-semibold">
                    {room.number}
                    {b.label}
                  </span>
                  <Money paise={b.rentPaise} />
                  <Badge tone={b.status === "vacant" ? "gray" : b.status === "blocked" ? "red" : "green"}>{b.status}</Badge>
                  <span className="ml-auto flex gap-1">
                    {b.status === "vacant" || b.status === "blocked" ? (
                      <ActionForm action={updateBedAction} submit={b.status === "blocked" ? "Unblock" : "Block"} inline variant="secondary">
                        <input type="hidden" name="bedId" value={b.id} />
                        <input type="hidden" name="block" value={b.status === "blocked" ? "no" : "yes"} />
                      </ActionForm>
                    ) : null}
                  </span>
                </div>
              )),
            )}
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
