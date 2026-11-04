"use server";

import { formatPeriod, isPeriod } from "@rentflow/core";
import { addDraftLine, approveCycle, createOrRebuildDraft, removeDraftLine, UserError } from "@rentflow/server";
import { redirect } from "next/navigation";
import { action, requiredPaise, str } from "@/lib/actions";

export const createDraftAction = action(async ({ actor, deps, form }) => {
  const period = str(form, "period");
  if (!isPeriod(period)) throw new UserError("Pick a month.");
  const id = await createOrRebuildDraft(deps, actor, str(form, "propertyId"), period);
  redirect(`/billing/${id}`);
});

export const rebuildAction = action(async ({ actor, deps, form }) => {
  await createOrRebuildDraft(deps, actor, str(form, "propertyId"), str(form, "period"));
  return `Recalculated ${formatPeriod(str(form, "period"))} from the latest readings and tenants. Lines you added were kept.`;
});

export const addLineAction = action(async ({ actor, deps, form }) => {
  await addDraftLine(deps, actor, str(form, "billId"), {
    kind: str(form, "kind") === "adjustment" ? "adjustment" : "service",
    description: str(form, "description"),
    amountPaise: await requiredPaise(form, "amount", "Amount"),
  });
  return "Line added.";
});

export const removeLineAction = action(async ({ actor, deps, form }) => {
  await removeDraftLine(deps, actor, str(form, "lineId"));
  return "Removed.";
});

export const approveAction = action(async ({ actor, deps, form }) => {
  await approveCycle(deps, actor, str(form, "cycleId"));
  return "Approved and locked. Bills are being sent on WhatsApp.";
});
