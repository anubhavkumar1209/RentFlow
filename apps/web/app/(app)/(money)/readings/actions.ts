"use server";

import { isPeriod } from "@rentflow/core";
import { recordMeterReading, UserError } from "@rentflow/server";
import { action, fileBytes, str } from "@/lib/actions";

export const readingAction = action(async ({ actor, deps, form }) => {
  const period = str(form, "period");
  if (!isPeriod(period)) throw new UserError("Pick a month.");
  const raw = str(form, "reading");
  if (!/^\d+$/.test(raw)) throw new UserError("Enter the reading in whole units (no decimals).");
  await recordMeterReading(deps, actor, { meterId: str(form, "meterId"), period, reading: Number(raw), photo: await fileBytes(form, "photo") });
  return "Saved ✓";
});
