import { formatPhone } from "@rentflow/core";
import { DEFAULT_MANAGER_PERMISSIONS, queries } from "@rentflow/server";
import { ActionForm } from "@/components/action-form";
import { Badge, Check, Field, Page, Section } from "@/components/ui";
import { asCurrentUser, requireOwnerActor } from "@/lib/session";
import { addManagerAction, removeManagerAction, updateAccessAction } from "./actions";

const PERM_LABELS = [
  ["manage_tenants", "Add tenants and check them out"],
  ["record_cash", "Record cash"],
  ["enter_readings", "Enter meter readings"],
  ["edit_prices", "Change rents and charges"],
] as const;

function AccessFields({ properties, selected, permissions }: { properties: { id: string; name: string }[]; selected: string[]; permissions: Record<string, boolean> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Properties</legend>
        {properties.map((p) => (
          <Check key={p.id} label={p.name} name="propertyIds" value={p.id} defaultChecked={selected.includes(p.id)} />
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Can</legend>
        {PERM_LABELS.map(([key, label]) => (
          <Check key={key} label={label} name={key} defaultChecked={permissions[key]} />
        ))}
        <p className="mt-1 text-xs text-ink-2">Managers can never approve bills or settle UPI payments.</p>
      </fieldset>
    </div>
  );
}

export default async function StaffPage() {
  const actor = await requireOwnerActor();
  const [staff, properties] = await asCurrentUser(async (tx) => [await queries.staffList(tx, actor.orgId), await queries.listProperties(tx, actor.orgId)] as const);
  const props = properties.map((p) => ({ id: p.id, name: p.name }));

  return (
    <Page title="Staff" subtitle="Managers handle daily work on their phone: tenants, meter readings and cash.">
      {staff.map((s) => (
        <Section
          key={s.userId}
          title={s.name ?? formatPhone(s.phone)}
          description={formatPhone(s.phone)}
          actions={<Badge tone={s.role === "owner" ? "blue" : "gray"}>{s.role === "owner" ? "Owner" : "Manager"}</Badge>}
        >
          {s.role === "manager" ? (
            <div className="space-y-3">
              <ActionForm action={updateAccessAction} submit="Save access">
                <input type="hidden" name="userId" value={s.userId} />
                <AccessFields properties={props} selected={s.access.map((a) => a.propertyId)} permissions={{ ...DEFAULT_MANAGER_PERMISSIONS, ...(s.access[0]?.permissions ?? {}) }} />
              </ActionForm>
              <ActionForm action={removeManagerAction} submit="Remove manager" variant="danger" confirm={`Remove ${s.name ?? "this manager"}? They lose access immediately.`}>
                <input type="hidden" name="userId" value={s.userId} />
              </ActionForm>
            </div>
          ) : (
            <p className="text-sm text-ink-2">Full access.</p>
          )}
        </Section>
      ))}
      <Section title="Add a manager">
        <ActionForm action={addManagerAction} submit="Add manager" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" name="name" required />
            <Field label="Mobile number" name="phone" type="tel" inputMode="tel" required />
          </div>
          <AccessFields properties={props} selected={props.map((p) => p.id)} permissions={DEFAULT_MANAGER_PERMISSIONS} />
        </ActionForm>
      </Section>
    </Page>
  );
}
