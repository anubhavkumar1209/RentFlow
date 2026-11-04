/** What each background job does. pg-boss (production) and the inline runner (demo, tests) both call this. */
import type { AppDeps, JobName } from "./ports";
import { sendCashConfirmation } from "./services/cash";
import { sendRefundConfirmation } from "./services/checkout";
import { hourInIndia, runDaily } from "./services/daily";
import { sendCycleBills, sendWelcome } from "./services/outbound";
import { sendReceipt } from "./services/receipts";

export async function runJob(deps: AppDeps, name: JobName, data: Record<string, unknown>): Promise<void> {
  const id = (key: string) => {
    const v = data[key];
    if (typeof v !== "string") throw new Error(`${name}: missing ${key}`);
    return v;
  };
  switch (name) {
    case "bills.send":
      await sendCycleBills(deps, id("cycleId"));
      return;
    case "receipt.send":
      await sendReceipt(deps, id("receiptId"));
      return;
    case "welcome.send":
      await sendWelcome(deps, id("tenancyId"));
      return;
    case "cash.confirm.send":
      await sendCashConfirmation(deps, id("cashEntryId"));
      return;
    case "refund.confirm.send":
      await sendRefundConfirmation(deps, id("tenancyId"));
      return;
    case "daily.run":
      // Hourly in production, so each PG's automations go out at the hour its owner chose.
      // A given `today` (demo "fast-forward", tests) runs everything due that day, any hour.
      if (typeof data.today === "string") await runDaily(deps, data.today);
      else await runDaily(deps, undefined, { hour: hourInIndia(deps.now()) });
      return;
  }
}
