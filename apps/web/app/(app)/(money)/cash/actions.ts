"use server";

import { formatINR, todayInIndia } from "@rentflow/core";
import { markCashHandedOver, recordCash, resendCashConfirmation, UserError } from "@rentflow/server";
import { action, requiredPaise, str } from "@/lib/actions";

export const recordCashAction = action(async ({ actor, deps, form }) => {
  const tenancyId = str(form, "tenancyId");
  if (!tenancyId) throw new UserError("Pick the tenant.");
  const amount = await requiredPaise(form, "amount", "Amount");
  await recordCash(deps, actor, { tenancyId, amountPaise: amount, receivedOn: str(form, "receivedOn") || todayInIndia(), note: str(form, "note") });
  return `Recorded ${formatINR(amount)}. The tenant is confirming it on WhatsApp.`;
});

export const resendAction = action(async ({ actor, deps, form }) => {
  await resendCashConfirmation(deps, actor, str(form, "id"));
  return "Sent again.";
});

export const handOverAction = action(async ({ actor, deps, form }) => {
  await markCashHandedOver(deps, actor, str(form, "ids").split(",").filter(Boolean));
  return "Marked as handed over.";
});
