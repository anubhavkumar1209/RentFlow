import { queries } from "@rentflow/server";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Empty, Page, Section } from "@/components/ui";
import { asCurrentUser, requireOwnerActor } from "@/lib/session";
import { createPropertyAction } from "./actions";
import { PropertyFields } from "./property-fields";

export default async function PropertiesPage() {
  const actor = await requireOwnerActor();
  const list = await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId));
  return (
    <Page title="Properties" subtitle="Each PG or hostel you run.">
      <Section>
        {list.length === 0 ? (
          <Empty>No properties yet. Add your first one below.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/properties/${p.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-page">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-ink-2">
                      {p.rooms} rooms · {p.occupied}/{p.beds} beds occupied · rent due on the {p.due_day}
                      {!p.upi_vpa ? " · no UPI ID yet" : ""}
                    </p>
                  </div>
                  <span className="text-muted">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="add" title="Add a property" className="scroll-mt-20">
        <ActionForm action={createPropertyAction} submit="Add property">
          <PropertyFields />
        </ActionForm>
      </Section>
    </Page>
  );
}
