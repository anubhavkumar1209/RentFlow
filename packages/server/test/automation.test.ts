/**
 * WhatsApp Automation through the real services and database: the owner's
 * schedule, automatic sending, the pay page, pause/resume, retry, and who may
 * confirm a payment.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asUser as asUserDb, type Db } from "@rentflow/db";
import { drizzleLocal, openLocalDb } from "@rentflow/db/local";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addManager,
  addTenant,
  approveCycle,
  automationOverview,
  billToken,
  createOrRebuildDraft,
  createProperty,
  generateRooms,
  loadActor,
  loadPayPage,
  manualSettle,
  retryMessage,
  runDaily,
  saveAutomation,
  setAutomationsPaused,
  setFixedCharges,
  submitPayScreenshot,
  type Actor,
  type OutboundMessage,
} from "../src";
import { createDemoDeps } from "../src/adapters/demo";
import { many, one } from "../src/sql";

let client: PGlite;
let db: Db;
let now = new Date("2026-11-25T10:00:00+05:30");
let deps: ReturnType<typeof createDemoDeps>;
let owner: Actor;
let manager: Actor;
let propertyId: string;
let priya: string;
let rahul: string;
const ownerUser = { id: "00000000-0000-4000-b000-000000000001", phone: "919800000101" };
const otherOwner = { id: "00000000-0000-4000-b000-000000000009", phone: "919800000109" };

const templates = (name: string) =>
  deps.whatsapp.sent.filter((s) => s.message.kind === "template" && s.message.name === name).map((s) => ({ to: s.to, message: s.message as Extract<OutboundMessage, { kind: "template" }> }));
const billOf = (tenancyId: string, period: string) =>
  one<{ id: string; status: string; payable_paise: unknown; sent_at: string | null }>(
    db,
    sql`select b.id, b.status, b.payable_paise, b.sent_at from bills b join billing_cycles c on c.id = b.cycle_id where b.tenancy_id = ${tenancyId} and c.period = ${period}`,
  );

beforeAll(async () => {
  client = await openLocalDb({ migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
  db = drizzleLocal(client);
  deps = createDemoDeps({ db, filesDir: mkdtempSync(path.join(os.tmpdir(), "rf-auto-")), jobs: "sync", pdf: { render: async () => null }, now: () => now });
  await asUserDb(db, ownerUser, (tx) => tx.execute(sql`select public.create_owner_org('Green Valley PG', 'Meera')`));
  await asUserDb(db, otherOwner, (tx) => tx.execute(sql`select public.create_owner_org('Other PG', 'Someone')`));
  owner = (await loadActor(db, ownerUser.id))!;

  // No electricity (rate blank), so nothing needs the owner's look and bills can go out on their own.
  propertyId = await createProperty(deps, owner, { name: "Green Valley PG", address: null, dueDay: 5, upiVpa: "greenvalley@okhdfc", payeeName: "Green Valley PG", electricityRatePaise: null, upiPhone: "+91 98765 43210" });
  await setFixedCharges(deps, owner, propertyId, [{ name: "Wi-Fi", amountPaise: 20000, active: true }]);
  await generateRooms(deps, owner, propertyId, { floorFrom: 1, floorTo: 1, roomsPerFloor: 1, startAt: 1, sharing: 2, defaultRentPaise: 600000 });
  const beds = await many<{ id: string }>(db, sql`select b.id from beds b join rooms r on r.id = b.room_id where r.property_id = ${propertyId} order by b.label`);
  priya = await addTenant(deps, owner, { propertyId, bedId: beds[0]!.id, name: "Priya Sharma", phone: "98765 11001", rentPaise: 600000, depositPaise: 0, depositReceived: false, checkIn: "2026-10-01", guardianPhones: [], language: "en" });
  rahul = await addTenant(deps, owner, { propertyId, bedId: beds[1]!.id, name: "Rahul Verma", phone: "98765 11002", rentPaise: 600000, depositPaise: 0, depositReceived: false, checkIn: "2026-10-01", guardianPhones: [], language: "hi" });
  await addManager(deps, owner, { name: "Ravi", phone: "+919800000102", propertyIds: [propertyId], permissions: {} });
  manager = (await loadActor(db, (await one<{ id: string }>(db, sql`select id from users where phone = '+919800000102'`))!.id))!;
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("WhatsApp Automation", () => {
  it("only the owner changes automations", async () => {
    await expect(saveAutomation(deps, manager, propertyId, "bill", { enabled: true, note: "", schedule: {} })).rejects.toThrow(/owner/);
    await expect(saveAutomation(deps, owner, propertyId, "reminder_overdue", { enabled: true, note: "", schedule: { daysAfter: [], weekly: false } })).rejects.toThrow(/at least one day/);
  });

  it("bills go out on the owner's day and hour, without approval when they chose so", async () => {
    await saveAutomation(deps, owner, propertyId, "bill", { enabled: true, note: "Rent covers Wi-Fi and cleaning.", schedule: { mode: "day", day: 1, hour: 18, approveFirst: false } });
    now = new Date("2026-12-01T09:00:00+05:30");
    expect(await runDaily(deps, "2026-12-01", { hour: 9 })).toMatchObject({ draftsCreated: 0, autoSent: 0 });
    now = new Date("2026-12-01T18:00:00+05:30");
    expect(await runDaily(deps, "2026-12-01", { hour: 18 })).toMatchObject({ draftsCreated: 1, autoSent: 1 });

    const bill = await billOf(priya, "2026-12");
    expect(bill?.status).toBe("sent");
    const [toPriya, toRahul] = templates("rf_bill");
    expect(toPriya?.message.variables.slice(6)).toEqual(["UPI ID: greenvalley@okhdfc · Name: Green Valley PG · UPI number: 98765 43210", "Rent covers Wi-Fi and cleaning."]);
    expect(toPriya?.message.urlSuffix).toBe(billToken(deps.config.receiptSecret, bill!.id));
    expect(toRahul?.message.variables[6]).toBe("UPI ID: greenvalley@okhdfc · नाम: Green Valley PG · UPI नंबर: 98765 43210");
    // Approved by the automation, not by a person.
    expect((await one<{ approved_by: string | null }>(db, sql`select approved_by from billing_cycles where property_id = ${propertyId}`))?.approved_by).toBeNull();
  });

  it("the pay page shows the exact amount with UPI app links, and a screenshot is never proof", async () => {
    const bill = (await billOf(priya, "2026-12"))!;
    const token = billToken(deps.config.receiptSecret, bill.id);
    const page = (await loadPayPage(deps, token))!;
    expect(page).toMatchObject({ firstName: "Priya", status: "unpaid", toPayPaise: Number(bill.payable_paise), upiPhone: "98765 43210" });
    expect(page.appLinks.map((a) => a.label)).toEqual(["PhonePe", "Google Pay", "Paytm"]);
    expect(page.qr).toMatch(/^data:image\/png;base64,/);
    expect(await loadPayPage(deps, `${bill.id}.forged-signature`)).toBeNull();

    const shot = await sharp(randomBytes(64 * 64 * 3), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
    expect(await submitPayScreenshot(deps, token, { bytes: shot, contentType: "image/png" })).toBe("saved");
    expect(await submitPayScreenshot(deps, token, { bytes: shot, contentType: "image/png" })).toBe("duplicate");
    expect(await submitPayScreenshot(deps, token, { bytes: Buffer.from("x"), contentType: "application/pdf" })).toBe("invalid");
    expect((await loadPayPage(deps, token))?.status).toBe("confirming");
    expect((await billOf(priya, "2026-12"))?.status).toBe("sent");
  });

  it("a manager can confirm a UPI payment for their PG; the tenant gets the receipt with the owner's note", async () => {
    const bill = (await billOf(priya, "2026-12"))!;
    await manualSettle(deps, manager, { tenancyId: priya, amountPaise: Number(bill.payable_paise), utr: "630611112222", note: "Checked in bank app", receivedOn: "2026-12-02" });
    expect((await billOf(priya, "2026-12"))?.status).toBe("paid");
    const page = (await loadPayPage(deps, billToken(deps.config.receiptSecret, bill.id)))!;
    expect(page.status).toBe("paid");
    expect(page.receiptUrl).toMatch(/^\/r\//);
    expect(templates("rf_payment_received").at(-1)?.message.variables[4]).toBe("Thank you for paying on time!");
    const match = await one<{ confirmed_by: string }>(db, sql`select confirmed_by from payment_matches where bill_id = ${bill.id}`);
    expect(match?.confirmed_by).toBe(manager.userId);

    const outsider = { ...manager, access: new Map() };
    await expect(manualSettle(deps, outsider, { tenancyId: rahul, amountPaise: 100, utr: null, note: "", receivedOn: "2026-12-02" })).rejects.toThrow(/PGs you manage/);
  });

  it("reminders follow the owner's days and hours, skip paid tenants, and stop while paused", async () => {
    await saveAutomation(deps, owner, propertyId, "reminder_before", { enabled: false, note: "", schedule: {} });
    expect((await runDaily(deps, "2026-12-03")).remindersSent).toBe(0);

    await setAutomationsPaused(deps, owner, propertyId, true);
    expect((await runDaily(deps, "2026-12-05", { hour: 11 })).remindersSent).toBe(0);
    await setAutomationsPaused(deps, owner, propertyId, false);
    expect((await runDaily(deps, "2026-12-05", { hour: 9 })).remindersSent).toBe(0);
    expect((await runDaily(deps, "2026-12-05", { hour: 10 })).remindersSent).toBe(1);
    const last = templates("rf_reminder").at(-1)!;
    expect(last.to).toBe("+919876511002");
    expect(last.message.variables[3]).toBe("आज देय है");
    expect(last.message.variables[4]).toBe("देर से बचने के लिए कृपया आज भुगतान करें।");
    expect((await runDaily(deps, "2026-12-05", { hour: 11 })).remindersSent).toBe(0);
  });

  it("approved bills wait while paused and go out on resume", async () => {
    await setAutomationsPaused(deps, owner, propertyId, true);
    const cycleId = await createOrRebuildDraft(deps, owner, propertyId, "2027-01");
    await approveCycle(deps, owner, cycleId);
    expect((await billOf(rahul, "2027-01"))?.sent_at).toBeNull();
    expect(await setAutomationsPaused(deps, owner, propertyId, false)).toEqual({ resumed: 1 });
    expect((await billOf(rahul, "2027-01"))?.sent_at).not.toBeNull();
  });

  it("a failed message shows on the monitor and can be sent again", async () => {
    const send = deps.whatsapp.send.bind(deps.whatsapp);
    deps.whatsapp.send = async () => {
      throw new Error("WhatsApp is down");
    };
    now = new Date("2027-01-08T10:00:00+05:30");
    expect((await runDaily(deps, "2027-01-08")).remindersSent).toBe(0);
    deps.whatsapp.send = send;

    const overview = await automationOverview(deps, owner, propertyId);
    expect(overview.health.reminder_overdue).toBe("attention");
    const failed = overview.recent.find((r) => r.status === "failed")!;
    expect(failed).toMatchObject({ automation: "reminder_overdue", error: "WhatsApp is down" });
    await retryMessage(deps, owner, failed.id);
    const after = await automationOverview(deps, owner, propertyId);
    expect(after.recent.find((r) => r.id === failed.id)?.status).toBe("retried");
    expect(after.recent[0]).toMatchObject({ status: "sent", automation: "reminder_overdue" });
    await expect(retryMessage(deps, owner, failed.id)).rejects.toThrow(/Only failed/);
    // Today's run doesn't resend on its own: retries are the owner's call.
    expect((await runDaily(deps, "2027-01-08")).remindersSent).toBe(0);
  });

  it("the monitor and previews reflect the settings", async () => {
    const o = await automationOverview(deps, owner, propertyId);
    expect(o.property).toMatchObject({ upiPhone: "9876543210", paused: false });
    expect(o.health).toMatchObject({ bill: "active", reminder_before: "off", payment_confirmation: "active" });
    expect(o.nextBill).toEqual({ period: "2027-02", date: "2027-02-01" });
    expect(o.cycle).toMatchObject({ period: "2027-01", bills: 2, sent: 2 });
    expect(o.previews.bill).toContain("Rent covers Wi-Fi and cleaning.");
    expect(o.previews.bill).toContain("UPI number: 98765 43210");
  });

  it("RLS: another owner can't read these automations", async () => {
    const mine = await asUserDb(db, ownerUser, (tx) => tx.execute(sql`select key from automations`));
    const theirs = await asUserDb(db, otherOwner, (tx) => tx.execute(sql`select key from automations`));
    const rows = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows);
    expect(rows(mine).length).toBeGreaterThan(0);
    expect(rows(theirs)).toEqual([]);
  });

  it("no background job failed", () => {
    expect(deps.jobs.errors).toEqual([]);
  });
});
