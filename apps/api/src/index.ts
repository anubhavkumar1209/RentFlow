/**
 * Production entry point: HTTP (webhooks) + background workers in one process.
 * Configure with the variables in apps/api/.env.example.
 */
import { runJob } from "@rentflow/server";
import { createProductionDeps, JOB_NAMES } from "@rentflow/server/production";
import { buildServer } from "./server";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const deps = createProductionDeps();
const app = buildServer({
  deps,
  waAppSecret: env("WA_APP_SECRET"),
  waVerifyToken: env("WA_VERIFY_TOKEN"),
  inboundSecret: env("INBOUND_EMAIL_SECRET"),
});

async function startWorkers() {
  const boss = await deps.jobs.boss();
  for (const name of JOB_NAMES) {
    await boss.work<Record<string, unknown>>(name, async (jobs) => {
      for (const job of jobs) await runJob(deps, name, job.data);
    });
  }
  // WhatsApp automations (bills, reminders) at each owner's chosen hour, plus the 48-hour screenshot check.
  await boss.schedule("daily.run", "0 * * * *", {}, { tz: "Asia/Kolkata" });
  app.log.info("workers started");
}

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(startWorkers)
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
