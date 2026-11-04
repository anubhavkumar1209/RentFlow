"use server";

import { isISODate, todayInIndia } from "@rentflow/core";
import { addCreditFromEmail, confirmCreditMatch, ignoreCredit, ignoreEmail, UserError } from "@rentflow/server";
import { action, requiredPaise, str } from "@/lib/actions";

export const confirmMatchAction = action(async ({ actor, deps, form }) => {
  const billId = str(form, "billId");
  if (!billId) throw new UserError("Pick the tenant this payment is from.");
  await confirmCreditMatch(deps, actor, str(form, "creditId"), billId);
  return "Matched. Receipt sent, and this payer will be suggested automatically next time.";
});

export const ignoreCreditAction = action(async ({ actor, deps, form }) => {
  await ignoreCredit(deps, actor, str(form, "creditId"));
  return "Ignored.";
});

export const addFromEmailAction = action(async ({ actor, deps, form }) => {
  const date = str(form, "date") || todayInIndia();
  if (!isISODate(date)) throw new UserError("Enter the date.");
  await addCreditFromEmail(deps, actor, str(form, "emailId"), {
    amountPaise: await requiredPaise(form, "amount", "Amount"),
    utr: str(form, "utr") || null,
    payerName: str(form, "payer") || null,
    creditedOn: date,
  });
  return "Added. It now appears under unmatched payments.";
});

export const ignoreEmailAction = action(async ({ actor, deps, form }) => {
  await ignoreEmail(deps, actor, str(form, "emailId"));
  return "Ignored.";
});
