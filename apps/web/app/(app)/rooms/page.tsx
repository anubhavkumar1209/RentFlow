import { can, queries } from "@rentflow/server";
import { cn } from "@rentflow/ui";
import { BedDouble } from "lucide-react";
import Link from "next/link";
import { Empty, LinkButton, Page, Section } from "@/components/ui";
import { selectedPropertyId } from "@/lib/property";
import { asCurrentUser, requireActor } from "@/lib/session";

const TILE: Record<string, string> = {
  vacant: "border-line bg-card text-ink-2",
  occupied: "border-success/30 bg-success-soft text-success",
  notice: "border-warning/30 bg-warning-soft text-warning",
  blocked: "border-line bg-page text-muted line-through",
};

/** Rooms & Beds (CLAUDE.md H6.5): visual grid by floor for the selected property. */
export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const properties = await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId));
  const ids = properties.map((p) => p.id);
  const propertyId = sp.property && ids.includes(sp.property) ? sp.property : ((await selectedPropertyId(ids)) ?? ids[0]);
  const p = propertyId ? await asCurrentUser((tx) => queries.propertyDetail(tx, actor.orgId, propertyId)) : null;

  if (!p) {
    return (
      <Page title="Rooms & Beds">
        <Empty icon={<BedDouble />} action={actor.role === "owner" ? <LinkButton href="/properties">Add a property</LinkButton> : undefined}>
          No properties yet.
        </Empty>
      </Page>
    );
  }

  const beds = p.rooms.flatMap((r) => r.beds);
  const count = (s: string) => beds.filter((b) => b.status === s).length;
  const floors = [...new Map(p.rooms.map((r) => [r.floorId, { id: r.floorId, name: r.floorName, sort: r.floorSort }])).values()].sort((a, b) => a.sort - b.sort);

  return (
    <Page
      title="Rooms & Beds"
      subtitle={`${p.name} · ${count("occupied") + count("notice")} occupied · ${count("vacant")} vacant · ${count("notice")} on notice`}
      actions={
        <>
          {properties.length > 1 ? (
            <form method="get" className="flex gap-2">
              <select name="property" defaultValue={p.id} aria-label="Property" className="h-11 rounded-[var(--radius-input)] border border-line bg-card px-3 text-sm">
                {properties.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <button className="h-11 rounded-[var(--radius-input)] border border-line bg-card px-3 text-sm font-medium">Show</button>
            </form>
          ) : null}
          {can(actor, p.id, "manage_tenants") && count("vacant") > 0 ? <LinkButton href={`/tenants/new?property=${p.id}`}>Add tenant</LinkButton> : null}
        </>
      }
    >
      <div className="flex flex-wrap gap-3 text-xs text-ink-2">
        {[
          ["occupied", "Occupied"],
          ["notice", "Notice period"],
          ["vacant", "Vacant"],
          ["blocked", "Unavailable"],
        ].map(([s, label]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded border", TILE[s as string])} /> {label}
          </span>
        ))}
      </div>

      {p.rooms.length === 0 ? (
        <Empty icon={<BedDouble />} action={actor.role === "owner" ? <LinkButton href={`/properties/${p.id}`}>Generate rooms</LinkButton> : undefined}>
          No rooms yet.
        </Empty>
      ) : (
        floors.map((floor) => (
          <Section key={floor.id} title={floor.name}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {p.rooms
                .filter((r) => r.floorId === floor.id)
                .map((room) => (
                  <div key={room.id} className="rounded-[var(--radius-card)] border border-line p-2">
                    <p className="mb-1.5 px-1 text-sm font-semibold text-ink">
                      {room.number} <span className="font-normal text-ink-2">· {room.sharing}-sharing</span>
                    </p>
                    <div className="grid gap-1.5">
                      {room.beds.map((b) => {
                        const label = b.tenantName?.split(" ")[0] ?? (b.status === "blocked" ? "Unavailable" : "Vacant");
                        const href = b.tenancyId ? `/tenants/${b.tenancyId}` : b.status === "vacant" && can(actor, p.id, "manage_tenants") ? `/tenants/new?property=${p.id}&bed=${b.id}` : null;
                        const cls = cn("flex min-h-11 items-center gap-1.5 rounded-[var(--radius-input)] border px-2 text-xs", TILE[b.status] ?? TILE.vacant);
                        const inner = (
                          <>
                            <span className="font-semibold">{b.label}</span>
                            <span className="truncate">{label}</span>
                          </>
                        );
                        return href ? (
                          <Link key={b.id} href={href} className={cn(cls, "hover:brightness-95")}>
                            {inner}
                          </Link>
                        ) : (
                          <div key={b.id} className={cls}>
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </Section>
        ))
      )}
      {/* TODO(M2): filters (floor, status, sharing), bed side panel, reserve/transfer, dues dot. */}
    </Page>
  );
}
