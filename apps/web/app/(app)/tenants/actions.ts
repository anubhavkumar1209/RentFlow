"use server";

import { isISODate, todayInIndia, toLanguage } from "@rentflow/core";
import { beds } from "@rentflow/db";
import {
  addAdjustment,
  addTenant,
  cancelNotice,
  closeTenancy,
  draftFinalBill,
  giveNotice,
  manualSettle,
  recordCash,
  recordDepositReceived,
  settleDeposit,
  updateTenant,
  UserError,
} from "@rentflow/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { action, fileBytes, paise, requiredPaise, str } from "@/lib/actions";
import { formatINR } from "@rentflow/core";

const guardians = (form: FormData) =>
  str(form, "guardians")
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);

export const addTenantAction = action(async ({ actor, deps, form }) => {
  const bedId = str(form, "bedId");
  if (!bedId) throw new UserError("Pick a bed.");
  let rentPaise = await paise(form, "rent", "Rent");
  if (rentPaise === null) {
    const [bed] = await deps.db.select({ rent: beds.defaultRentPaise }).from(beds).where(eq(beds.id, bedId));
    rentPaise = bed?.rent ?? 0;
  }
  const tenancyId = await addTenant(deps, actor, {
    propertyId: str(form, "propertyId"),
    bedId,
    name: str(form, "name"),
    phone: str(form, "phone"),
    rentPaise,
    depositPaise: (await paise(form, "deposit", "Deposit")) ?? 0,
    depositReceived: form.get("depositReceived") === "on",
    checkIn: str(form, "checkIn"),
    guardianPhones: guardians(form),
    language: toLanguage(str(form, "language")),
  });
  redirect(`/tenants/${tenancyId}?welcome=1`);
});

export const updateTenantAction = action(async ({ actor, deps, form }) => {
  await updateTenant(deps, actor, str(form, "tenancyId"), {
    name: str(form, "name"),
    guardianPhones: guardians(form),
    language: toLanguage(str(form, "language")),
    rentPaise: await requiredPaise(form, "rent", "Rent"),
    depositPaise: (await paise(form, "deposit", "Deposit")) ?? 0,
  });
  return "Saved. A new rent applies from the next bill.";
});

export const recordCashAction = action(async ({ actor, deps, form }) => {
  const amount = await requiredPaise(form, "amount", "Amount");
  await recordCash(deps, actor, { tenancyId: str(form, "tenancyId"), amountPaise: amount, receivedOn: str(form, "receivedOn") || todayInIndia(), note: str(form, "note") });
  return `Recorded ${formatINR(amount)}. The tenant has been asked to confirm on WhatsApp — it counts as paid once they do.`;
});

export const manualSettleAction = action(async ({ actor, deps, form }) => {
  const amount = await requiredPaise(form, "amount", "Amount");
  await manualSettle(deps, actor, { tenancyId: str(form, "tenancyId"), amountPaise: amount, utr: str(form, "utr") || null, note: str(form, "note"), receivedOn: str(form, "receivedOn") || todayInIndia() });
  return `Payment of ${formatINR(amount)} recorded. A receipt is on its way to the tenant.`;
});

export const adjustmentAction = action(async ({ actor, deps, form }) => {
  const amount = await requiredPaise(form, "amount", "Amount");
  await addAdjustment(deps, actor, str(form, "tenancyId"), amount, str(form, "description"));
  return "Adjustment recorded. It will show on the next bill.";
});

export const depositReceivedAction = action(async ({ actor, deps, form }) => {
  await recordDepositReceived(deps, actor, str(form, "tenancyId"), await requiredPaise(form, "amount", "Deposit"));
  return "Deposit recorded.";
});

export const noticeAction = action(async ({ actor, deps, form }) => {
  const noticeDate = str(form, "noticeDate");
  const checkOut = str(form, "checkOut");
  if (!isISODate(noticeDate) || !isISODate(checkOut)) throw new UserError("Enter both dates.");
  await giveNotice(deps, actor, str(form, "tenancyId"), { noticeDate, checkOut });
  return "Notice recorded. The bed shows as 'on notice'.";
});

export const cancelNoticeAction = action(async ({ actor, deps, form }) => {
  await cancelNotice(deps, actor, str(form, "tenancyId"));
  return "Notice cancelled.";
});

export const finalBillAction = action(async ({ actor, deps, form }) => {
  const damages: { description: string; amountPaise: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const description = str(form, `damage_${i}`);
    const amount = await paise(form, `damageAmount_${i}`, "Damage amount");
    if (description || amount) damages.push({ description, amountPaise: amount ?? 0 });
  }
  const reading = str(form, "finalReading");
  const cycleId = await draftFinalBill(deps, actor, str(form, "tenancyId"), {
    finalReading: reading ? Number(reading) : null,
    photo: await fileBytes(form, "photo"),
    damages,
  });
  redirect(`/billing/${cycleId}`);
});

export const settleDepositAction = action(async ({ actor, deps, form }) => {
  const r = await settleDeposit(deps, actor, str(form, "tenancyId"));
  if (r.refundPaise > 0) return `Deposit ${formatINR(r.depositPaise)}: ${formatINR(r.appliedPaise)} used for dues, refund ${formatINR(r.refundPaise)}. Pay the refund, and the tenant will confirm it on WhatsApp.`;
  if (r.stillOwedPaise > 0) return `The deposit covered ${formatINR(r.appliedPaise)}; the tenant still owes ${formatINR(r.stillOwedPaise)}.`;
  return "Settled — nothing to refund. The stay is closed.";
});

export const closeTenancyAction = action(async ({ actor, deps, form }) => {
  await closeTenancy(deps, actor, str(form, "tenancyId"));
  return "Stay closed. The bed is vacant.";
});
