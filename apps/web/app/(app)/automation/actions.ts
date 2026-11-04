"use server";

import { AUTOMATION_KEYS, type AutomationKey } from "@rentflow/core";
import { retryMessage, saveAutomation, setAutomationsPaused, UserError } from "@rentflow/server";
import { action, str } from "@/lib/actions";

const int = (form: FormData, key: string) => Number(str(form, key));

/** Reads one automation card's form; the core parser fills in or corrects anything out of range. */
function scheduleFrom(key: AutomationKey, form: FormData): Record<string, unknown> {
  switch (key) {
    case "bill":
      return { mode: str(form, "mode"), day: int(form, "day"), daysBefore: int(form, "daysBefore"), hour: int(form, "hour"), approveFirst: form.get("approveFirst") === "on" };
    case "reminder_before":
      return { daysBefore: int(form, "daysBefore"), hour: int(form, "hour") };
    case "reminder_due":
      return { hour: int(form, "hour") };
    case "reminder_overdue":
      return { daysAfter: form.getAll("daysAfter").map(Number), weekly: form.get("weekly") === "on", hour: int(form, "hour") };
    case "payment_confirmation":
      return {};
  }
}

export const saveAutomationAction = action(async ({ actor, deps, form }) => {
  const key = str(form, "key") as AutomationKey;
  if (!AUTOMATION_KEYS.includes(key)) throw new UserError("Unknown automation.");
  const enabled = form.get("enabled") === "on";
  await saveAutomation(deps, actor, str(form, "propertyId"), key, { enabled, note: str(form, "note"), schedule: scheduleFrom(key, form) });
  return enabled ? "Saved. It runs on the new settings from now on." : "Saved. This automation is off.";
});

export const pauseAutomationsAction = action(async ({ actor, deps, form }) => {
  await setAutomationsPaused(deps, actor, str(form, "propertyId"), true);
  return "Paused. Nothing goes out on WhatsApp until you resume.";
});

export const resumeAutomationsAction = action(async ({ actor, deps, form }) => {
  const { resumed } = await setAutomationsPaused(deps, actor, str(form, "propertyId"), false);
  return resumed > 0 ? `Resumed. ${resumed} held-back send${resumed === 1 ? " is" : "s are"} going out now.` : "Resumed.";
});

export const retryMessageAction = action(async ({ actor, deps, form }) => {
  await retryMessage(deps, actor, str(form, "logId"));
  return "Sent again.";
});
