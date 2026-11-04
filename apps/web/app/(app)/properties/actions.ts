"use server";

import { createProperty, generateRooms, setFixedCharges, updateBed, updateProperty, type PropertyInput } from "@rentflow/server";
import { redirect } from "next/navigation";
import { action, paise, requiredPaise, str } from "@/lib/actions";

async function propertyInput(form: FormData): Promise<PropertyInput> {
  const lateFee = await paise(form, "lateFee", "Late fee");
  return {
    name: str(form, "name"),
    address: str(form, "address") || null,
    dueDay: Number(str(form, "dueDay")),
    upiVpa: str(form, "upiVpa") || null,
    payeeName: str(form, "payeeName") || null,
    electricityRatePaise: await paise(form, "rate", "Electricity rate"),
    lateFeeRule: lateFee && lateFee > 0 ? { amount_paise: lateFee, grace_days: Number(str(form, "graceDays") || 0) } : null,
    upiPhone: str(form, "upiPhone") || null,
  };
}

export const createPropertyAction = action(async ({ actor, deps, form }) => {
  const id = await createProperty(deps, actor, await propertyInput(form));
  redirect(`/properties/${id}?new=1`);
});

export const updatePropertyAction = action(async ({ actor, deps, form }) => {
  await updateProperty(deps, actor, str(form, "propertyId"), await propertyInput(form));
  return "Property saved.";
});

export const setChargesAction = action(async ({ actor, deps, form }) => {
  const rows: { id?: string; name: string; amountPaise: number; active: boolean }[] = [];
  for (let i = 0; i < 20; i++) {
    const name = str(form, `name_${i}`);
    if (!name && !str(form, `amount_${i}`)) continue;
    const amountPaise = await requiredPaise(form, `amount_${i}`, `Amount for ${name || "charge"}`);
    const id = str(form, `id_${i}`);
    rows.push({ ...(id ? { id } : {}), name, amountPaise, active: form.get(`active_${i}`) === "on" });
  }
  await setFixedCharges(deps, actor, str(form, "propertyId"), rows);
  return "Charges saved. They apply from the next draft bill.";
});

export const generateRoomsAction = action(async ({ actor, deps, form }) => {
  const result = await generateRooms(deps, actor, str(form, "propertyId"), {
    floorFrom: Number(str(form, "floorFrom")),
    floorTo: Number(str(form, "floorTo")),
    roomsPerFloor: Number(str(form, "roomsPerFloor")),
    startAt: Number(str(form, "startAt") || 1),
    sharing: Number(str(form, "sharing")),
    defaultRentPaise: await requiredPaise(form, "rent", "Rent per bed"),
  });
  return `${result.created} room${result.created === 1 ? "" : "s"} created${result.skipped.length ? ` (skipped existing: ${result.skipped.join(", ")})` : ""}.`;
});

export const updateBedAction = action(async ({ actor, deps, form }) => {
  const rent = await paise(form, "rent", "Rent");
  const block = str(form, "block");
  await updateBed(deps, actor, str(form, "bedId"), {
    ...(rent !== null ? { defaultRentPaise: rent } : {}),
    ...(block ? { blocked: block === "yes" } : {}),
  });
  return "Bed updated.";
});
