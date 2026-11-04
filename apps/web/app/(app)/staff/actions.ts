"use server";

import { addManager, removeManager, updateManagerAccess, type ManagerPermission } from "@rentflow/server";
import { action, str } from "@/lib/actions";

const PERMS: ManagerPermission[] = ["manage_tenants", "record_cash", "enter_readings", "edit_prices"];

function access(form: FormData) {
  return {
    propertyIds: form.getAll("propertyIds").map(String),
    permissions: Object.fromEntries(PERMS.map((p) => [p, form.get(p) === "on"])) as Record<ManagerPermission, boolean>,
  };
}

export const addManagerAction = action(async ({ actor, deps, form }) => {
  const a = access(form);
  await addManager(deps, actor, { name: str(form, "name"), phone: str(form, "phone"), ...a });
  return "Manager added. They log in with their phone number.";
});

export const updateAccessAction = action(async ({ actor, deps, form }) => {
  const a = access(form);
  await updateManagerAccess(deps, actor, str(form, "userId"), a.propertyIds, a.permissions);
  return "Access updated.";
});

export const removeManagerAction = action(async ({ actor, deps, form }) => {
  await removeManager(deps, actor, str(form, "userId"));
  return "Removed.";
});
