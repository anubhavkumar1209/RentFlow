import { formatPhone } from "@rentflow/core";
import { orgs } from "@rentflow/db";
import { queries } from "@rentflow/server";
import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import { toLocale } from "@/i18n/request";
import { getDeps } from "@/lib/deps";
import { isDemo } from "@/lib/env";
import { selectedPropertyId } from "@/lib/property";
import { asCurrentUser, requireActor } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const deps = await getDeps();
  const [org] = await deps.db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, actor.orgId));
  // RLS decides what's visible: managers only get their properties and their alerts.
  const [properties, attention] = await asCurrentUser(async (tx) => [await queries.listProperties(tx, actor.orgId), await queries.attention(tx, actor.orgId)] as const);
  const selected = await selectedPropertyId(properties.map((p) => p.id));

  return (
    <AppShell
      role={actor.role}
      demo={isDemo}
      orgName={org?.name ?? "RentFlow"}
      userName={actor.name}
      phone={formatPhone(actor.phone)}
      locale={toLocale(await getLocale())}
      properties={properties.map((p) => ({ id: p.id, name: p.name, occupied: p.occupied, beds: p.beds }))}
      selectedPropertyId={selected}
      attention={attention}
    >
      {children}
    </AppShell>
  );
}
