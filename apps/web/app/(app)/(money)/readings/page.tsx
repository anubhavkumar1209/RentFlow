import { addMonths, formatDate, formatPeriod, periodEnd, periodOf, todayInIndia } from "@rentflow/core";
import { can, queries } from "@rentflow/server";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Page, Section } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";
import { readingAction } from "./actions";

export default async function ReadingsPage({ searchParams }: { searchParams: Promise<{ property?: string; period?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const properties = (await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId))).filter((p) => can(actor, p.id, "enter_readings"));
  const propertyId = sp.property && properties.some((p) => p.id === sp.property) ? sp.property : properties[0]?.id;
  // Readings are taken at the start of a month for the month that just ended.
  const lastMonth = addMonths(periodOf(todayInIndia()), -1);
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : lastMonth;
  const meters = propertyId ? await asCurrentUser((tx) => queries.readingsForPeriod(tx, actor.orgId, propertyId, period)) : [];
  const done = meters.filter((m) => m.reading !== null).length;

  return (
    <Page title="Meter readings" subtitle={`Reading at the end of ${formatPeriod(period)} (${formatDate(periodEnd(period))}). ${done}/${meters.length} done.`}>
      <form method="get" className="flex flex-wrap gap-2">
        <select name="property" defaultValue={propertyId} className="h-11 flex-1 rounded-[var(--radius-input)] border border-line px-3">
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="period" defaultValue={period} className="h-11 rounded-[var(--radius-input)] border border-line px-3">
          {[0, -1, -2, -3].map((n) => {
            const p = addMonths(lastMonth, n + 1);
            return (
              <option key={p} value={p}>
                End of {formatPeriod(p)}
              </option>
            );
          })}
        </select>
        <button className="h-11 rounded-[var(--radius-input)] border border-line px-4 text-sm font-medium">Show</button>
      </form>

      {meters.length === 0 ? (
        <Empty>No meters here yet. Generating rooms creates one meter per room.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {meters.map((m) => (
            <Section key={m.meter_id}>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Room {m.room}</p>
                {m.reading !== null ? <Badge tone="green">{m.reading} units</Badge> : m.occupied ? <Badge tone="amber">needed</Badge> : <Badge>vacant</Badge>}
              </div>
              <p className="mb-2 text-xs text-ink-2">
                {m.previous !== null ? `Previous (${formatPeriod(m.previous_period ?? "")}): ${m.previous} units` : "No previous reading — this one becomes the opening reading."}
              </p>
              <ActionForm action={readingAction} submit={m.reading !== null ? "Update" : "Save reading"} className="space-y-2">
                <input type="hidden" name="meterId" value={m.meter_id} />
                <input type="hidden" name="period" value={period} />
                <input name="reading" inputMode="numeric" pattern="[0-9]*" defaultValue={m.reading ?? ""} placeholder="Units on the meter" required className="h-12 w-full rounded-[var(--radius-input)] border border-line px-3 text-lg tabular-nums" />
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Photo of the meter (required)</span>
                  <input name="photo" type="file" accept="image/*" capture="environment" required className="block w-full text-sm file:mr-3 file:h-10 file:rounded-[var(--radius-input)] file:border-0 file:bg-page file:px-4" />
                </label>
                {m.photo_ref ? (
                  <a href={`/files/${m.photo_ref}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">
                    See saved photo
                  </a>
                ) : null}
              </ActionForm>
            </Section>
          ))}
        </div>
      )}
    </Page>
  );
}
