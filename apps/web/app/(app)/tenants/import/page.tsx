import { can, queries } from "@rentflow/server";
import { Empty, Page, Section } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";
import { ImportForm } from "./import-form";

const SAMPLE = `name,phone,room,bed,rent,deposit,check_in,guardian_phone,language
Anubhav Kumar,98765 43210,101,A,6000,12000,01/11/2026,98765 11111,English
Priya Sharma,98765 43211,101,,6000,12000,05/11/2026,,Hindi`;

export default async function ImportPage() {
  const actor = await requireActor();
  const properties = (await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId))).filter((p) => can(actor, p.id, "manage_tenants"));
  return (
    <Page title="Import tenants" subtitle="Upload a CSV or Excel sheet. Every row is checked before anything is saved.">
      <Section>
        {properties.length === 0 ? <Empty>Add a property with rooms first.</Empty> : <ImportForm properties={properties.map((p) => ({ id: p.id, name: p.name }))} />}
      </Section>
      <Section title="File format" description="First row = column names. Leave 'bed' blank to use the first free bed in the room. Dates as DD/MM/YYYY.">
        <pre className="overflow-x-auto rounded-[var(--radius-input)] bg-page p-3 text-xs">{SAMPLE}</pre>
        <a className="mt-2 inline-block text-sm font-medium text-brand-700 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="rentflow-tenants-template.csv">
          Download this template
        </a>
      </Section>
    </Page>
  );
}
