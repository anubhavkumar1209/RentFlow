import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { drizzleLocal, openLocalDb } from "@rentflow/db/local";
import { createDemoDeps } from "@rentflow/server/demo";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server";

const SECRET = "app-secret";
let client: PGlite;
let deps: ReturnType<typeof createDemoDeps>;
let app: ReturnType<typeof buildServer>;

beforeAll(async () => {
  client = await openLocalDb({ migrationsFolder: fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)) });
  deps = createDemoDeps({ db: drizzleLocal(client), filesDir: mkdtempSync(path.join(os.tmpdir(), "rf-api-")), jobs: "sync", pdf: { render: async () => null } });
  app = buildServer({ deps, waAppSecret: SECRET, waVerifyToken: "verify-me", inboundSecret: "inbound-secret" });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const textMessage = (from: string, text: string) =>
  JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, id: `wamid.${Math.random()}`, type: "text", text: { body: text } }] } }] }] });

describe("api", () => {
  it("answers health checks", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("completes Meta's webhook handshake only with the right token", async () => {
    const ok = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("42");
    const bad = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42" });
    expect(bad.statusCode).toBe(403);
  });

  it("rejects webhook calls without a valid signature", async () => {
    const body = textMessage("919999999999", "hi");
    const res = await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload: body, headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" } });
    expect(res.statusCode).toBe(401);
    expect(deps.whatsapp.sent).toHaveLength(0);
  });

  it("routes signed messages to the bot", async () => {
    const body = textMessage("919999999999", "hi");
    const res = await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload: body, headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) } });
    expect(res.statusCode).toBe(200);
    expect(deps.whatsapp.sent.at(-1)).toMatchObject({ to: "+919999999999", message: { kind: "text", text: "This number isn't registered. Please ask your PG manager." } });
    const logged = await deps.db.execute(sql`select direction from message_log where phone = '+919999999999' order by created_at`);
    expect(JSON.stringify(logged)).toContain("in");
  });

  it("accepts inbound email only with the shared secret, and 404s unknown addresses", async () => {
    const payload = { to: "x-unknown@in.rentflow.app", from: "alerts@hdfcbank.net", subject: "", text: "", dkimVerified: true };
    expect((await app.inject({ method: "POST", url: "/inbound/email", payload })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/inbound/email", payload, headers: { "x-inbound-secret": "inbound-secret" } });
    expect(res.statusCode).toBe(404);
  });
});
