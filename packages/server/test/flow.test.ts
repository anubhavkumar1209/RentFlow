/**
 * A whole month through the real services and database (PGlite with the real
 * migrations): setup → readings → draft → approve → WhatsApp bill → bank email →
 * auto-match → receipt → screenshot + UTR → cash → reminders → check-out.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BANK_FIXTURES, periodOf, sampleCreditEmail, todayInIndia } from "@rentflow/core";
import { asUser as asUserDb, type Db } from "@rentflow/db";
import { drizzleLocal, openLocalDb } from "@rentflow/db/local";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDraftLine,
  addManager,
  addTenant,
  approveCycle,
  createOrRebuildDraft,
  createProperty,
  draftFinalBill,
  generateRooms,
  giveNotice,
  handleIncoming,
  loadActor,
  loadPayPage,
  queries,
  receiveInboundEmail,
  recordCash,
  recordMeterReading,
  runDaily,
  setFixedCharges,
  settleDeposit,
  verifyReceiptToken,
  receiptToken,
  type Actor,
} from "../src";
import { createDemoDeps } from "../src/adapters/demo";
import { many, one, toPaise } from "../src/sql";

let client: PGlite;
let db: Db;
let now = new Date("2026-12-01T10:00:00+05:30");
let deps: ReturnType<typeof createDemoDeps>;
let owner: Actor;
let propertyId: string;
let anubhav: string;
let anmol: string;
const ownerUser = { id: "00000000-0000-4000-a000-000000000001", phone: "919800000001" };
const photo = { bytes: Buffer.from("fake-jpeg"), contentType: "image/jpeg" };

async function noise(): Promise<Buffer> {
  return sharp(randomBytes(64 * 64 * 3), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
}
const sentTo = (phone: string) => deps.whatsapp.sent.filter((m) => m.to === phone);
const lastText = (phone: string) => {
  const m = sentTo(phone).at(-1)?.message;
  return m && "text" in m ? m.text : "";
};
const balance = async (tenancyId: string) =>
  toPaise((await one<{ b: unknown }>(db, sql`select coalesce(sum(amount_paise),0) as b from ledger_entries where tenancy_id = ${tenancyId} and type in ('charge','payment','reversal','adjustment')`))?.b);
const billOf = (tenancyId: string) =>
  one<{ id: string; total_paise: unknown; payable_paise: unknown; status: string }>(
    db,
    sql`select b.id, b.total_paise, b.payable_paise, b.status from bills b join billing_cycles c on c.id = b.cycle_id where b.tenancy_id = ${tenancyId} and c.kind = 'monthly' order by c.period desc limit 1`,
  );

beforeAll(async () => {
  client = await openLocalDb({ migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
  db = drizzleLocal(client);
  deps = createDemoDeps({ db, filesDir: mkdtempSync(path.join(os.tmpdir(), "rf-test-")), jobs: "sync", pdf: { render: async () => null }, now: () => now });
  await asUserDb(db, ownerUser, (tx) => tx.execute(sql`select public.create_owner_org('Sunrise PG', 'Rajan')`));
  owner = (await loadActor(db, ownerUser.id))!;
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("a full month", () => {
  it("M2: sets up the property, room 303 and two tenants", async () => {
    propertyId = await createProperty(deps, owner, { name: "Sunrise PG", address: "Koramangala", dueDay: 5, upiVpa: "sunrise@okaxis", payeeName: "Sunrise PG", electricityRatePaise: 800 });
    await setFixedCharges(deps, owner, propertyId, [{ name: "Wi-Fi", amountPaise: 20000, active: true }]);
    const rooms = await generateRooms(deps, owner, propertyId, { floorFrom: 3, floorTo: 3, roomsPerFloor: 1, startAt: 3, sharing: 2, defaultRentPaise: 200000 });
    expect(rooms).toEqual({ created: 1, skipped: [] });
    const bedIds = await many<{ id: string; label: string }>(db, sql`select b.id, b.label from beds b join rooms r on r.id = b.room_id where r.property_id = ${propertyId} order by b.label`);
    anubhav = await addTenant(deps, owner, { propertyId, bedId: bedIds[0]!.id, name: "Anubhav", phone: "98765 00001", rentPaise: 200000, depositPaise: 400000, depositReceived: true, checkIn: "2026-01-15", guardianPhones: [], language: "en" });
    anmol = await addTenant(deps, owner, { propertyId, bedId: bedIds[1]!.id, name: "Anmol", phone: "98765 00002", rentPaise: 400000, depositPaise: 0, depositReceived: false, checkIn: "2026-11-11", guardianPhones: [], language: "hi" });
    expect(sentTo("+919876500001")[0]?.message).toMatchObject({ kind: "template", name: "rf_welcome", variables: ["Sunrise PG", "Anubhav", "303", "A"] });
    await expect(addTenant(deps, owner, { propertyId, bedId: bedIds[0]!.id, name: "X", phone: "9000000000", rentPaise: 1, depositPaise: 0, depositReceived: false, checkIn: "2026-11-01", guardianPhones: [], language: "en" })).rejects.toThrow(/isn't vacant/);
  });

  it("M3: drafts December — Anmol's unbilled November days + the worked-example electricity split", async () => {
    const [meter] = await many<{ id: string }>(db, sql`select meter_id as id from rooms where property_id = ${propertyId}`);
    await recordMeterReading(deps, owner, { meterId: meter!.id, period: "2026-10", reading: 1000, photo });
    await recordMeterReading(deps, owner, { meterId: meter!.id, period: "2026-11", reading: 1120, photo });
    await expect(recordMeterReading(deps, owner, { meterId: meter!.id, period: "2026-11", reading: 1120, photo: null })).rejects.toThrow(/photo/);

    const cycleId = await createOrRebuildDraft(deps, owner, propertyId, "2026-12");
    const a = await billOf(anubhav);
    await addDraftLine(deps, owner, a!.id, { kind: "service", description: "Laundry", amountPaise: 9000 });
    // Rebuilding (e.g. after a reading changes) keeps hand-added lines.
    await createOrRebuildDraft(deps, owner, propertyId, "2026-12");

    const detail = await asUserDb(db, ownerUser, (tx) => queries.cycleDetail(tx, owner.orgId, cycleId));
    expect(detail?.anomalies).toEqual([]);
    const lines = (name: string) => detail!.bills.find((b) => b.tenantName === name)!.lines.map((l) => [l.kind, l.amountPaise]);
    expect(lines("Anubhav")).toEqual([["rent", 200000], ["metered", 57600], ["fixed", 20000], ["service", 9000]]);
    expect(lines("Anmol")).toEqual([["rent", 266700], ["rent", 400000], ["metered", 38400], ["fixed", 20000]]);
    expect(detail!.bills.find((b) => b.tenantName === "Anubhav")!.totalPaise).toBe(286600);
  });

  it("M3/M4: approval locks the cycle, writes the ledger, gives unique payables and sends the bills", async () => {
    const [cycle] = await many<{ id: string }>(db, sql`select id from billing_cycles where period = '2026-12'`);
    const manager = { id: "00000000-0000-4000-a000-000000000002", phone: "919800000002" };
    await addManager(deps, owner, { name: "Ravi", phone: "+919800000002", propertyIds: [propertyId], permissions: {} });
    const managerActor = { ...(await loadActor(db, (await one<{ id: string }>(db, sql`select id from users where phone = '+919800000002'`))!.id))! };
    await expect(approveCycle(deps, managerActor, cycle!.id)).rejects.toThrow(/owner/);
    void manager;

    await approveCycle(deps, owner, cycle!.id);
    const a = await billOf(anubhav);
    const m = await billOf(anmol);
    expect(toPaise(a!.payable_paise)).toBe(286601);
    expect(toPaise(m!.payable_paise)).toBe(725101);
    expect(await balance(anubhav)).toBe(286600);
    expect(await balance(anmol)).toBe(725100);
    await expect(addDraftLine(deps, owner, a!.id, { kind: "service", description: "x", amountPaise: 1 })).rejects.toThrow(/locked/);

    const bill = sentTo("+919876500001").find((s) => s.message.kind === "template" && s.message.name === "rf_bill")?.message;
    expect(bill).toMatchObject({
      kind: "template",
      name: "rf_bill",
      variables: ["Sunrise PG", "Dec 2026", "₹2,866", "₹2,866.01", "5 Dec 2026", expect.stringContaining("Electricity ₹576"), "UPI ID: sunrise@okaxis · Name: Sunrise PG", "Please pay by the due date. Thank you!"],
      buttonIds: ["menu:view_bill"],
      urlSuffix: expect.stringMatching(/^[0-9a-f-]{36}\./),
      header: { kind: "image" },
    });
    expect((await one<{ status: string }>(db, sql`select status from billing_cycles where id = ${cycle!.id}`))?.status).toBe("sent");
  });

  it("M4: the bot answers the tenant", async () => {
    await handleIncoming(deps, "919876500001", { kind: "text", text: "bill" });
    expect(lastText("+919876500001")).toContain("₹2,866.01");
    await handleIncoming(deps, "919876500001", { kind: "reply", id: "menu:pay_now" });
    const pay = sentTo("+919876500001").slice(-2).map((s) => s.message);
    expect(pay[0]).toMatchObject({ kind: "image" });
    // WhatsApp can't open upi:// links, so the text points to the pay page, which carries the exact UPI link.
    const text = (pay[1] as { text: string }).text;
    expect(text).toContain("Pay ONLY to this QR");
    const token = /\/p\/([0-9a-f-]{36}\.[\w-]+)/.exec(text)?.[1];
    expect((await loadPayPage(deps, token!))?.upiLink).toBe("upi://pay?pa=sunrise%40okaxis&pn=Sunrise%20PG&am=2866.01&tn=RF-303A-DEC&cu=INR");
    await handleIncoming(deps, "919999999999", { kind: "text", text: "hi" });
    expect(lastText("+919999999999")).toBe("This number isn't registered. Please ask your PG manager.");
  });

  it("M5/M6: a verified bank email auto-settles the exact amount and sends a receipt; the duplicate is rejected", async () => {
    now = new Date("2026-12-03T10:00:00+05:30");
    const token = (await one<{ t: string }>(db, sql`select inbound_email_token as t from orgs`))!.t;
    const email = sampleCreditEmail("hdfc", { amountPaise: 286601, utr: "630600000001", payerName: "Anubhav", payerVpa: "anubhav@okaxis", date: "2026-12-03" });
    const r = await receiveInboundEmail(deps, { to: `sunrise-${token}@in.rentflow.app`, from: BANK_FIXTURES[0]!.email.from, subject: email.subject, text: email.text, dkimVerified: true });
    expect(r).toMatchObject({ status: "parsed", decision: "auto" });
    expect((await billOf(anubhav))?.status).toBe("paid");
    expect(await balance(anubhav)).toBe(-1); // the 1-paisa suffix carries as credit
    const receipt = sentTo("+919876500001").at(-1)?.message;
    expect(receipt).toMatchObject({ kind: "template", name: "rf_payment_received", variables: ["Sunrise PG", "₹2,866.01", "RCT-00001", "₹0.01 advance", "Thank you for paying on time!"] });

    const again = await receiveInboundEmail(deps, { to: `sunrise-${token}@in.rentflow.app`, from: BANK_FIXTURES[0]!.email.from, subject: email.subject, text: email.text, dkimVerified: true });
    expect(again).toMatchObject({ status: "parsed", decision: "duplicate" });
    expect(await receiveInboundEmail(deps, { to: "nobody-xyz@in.rentflow.app", from: "a@b.c", subject: "", text: "", dkimVerified: true })).toEqual({ status: "unknown_address" });
  });

  it("M5: screenshot + last-4 UTR digits settles a credit whose amount doesn't match", async () => {
    await handleIncoming(deps, "919876500002", { kind: "image", bytes: await noise(), contentType: "image/png" });
    expect(lastText("+919876500002")).toContain("UTR");
    await handleIncoming(deps, "919876500002", { kind: "text", text: "5678" });
    const token = (await one<{ t: string }>(db, sql`select inbound_email_token as t from orgs`))!.t;
    // The claim is stamped by the database clock, so the credit must be within ±3 days of the real date.
    const email = sampleCreditEmail("icici", { amountPaise: 725100, utr: "630611115678", payerName: "Anmol Singh", payerVpa: "anmol@ybl", date: todayInIndia(new Date()) });
    const r = await receiveInboundEmail(deps, { to: `${token}@in.rentflow.app`, from: BANK_FIXTURES[1]!.email.from, subject: email.subject, text: email.text, dkimVerified: true });
    expect(r).toMatchObject({ decision: "auto" });
    const match = await one<{ method: string }>(db, sql`select method from payment_matches order by created_at desc limit 1`);
    expect(match?.method).toBe("utr_last4");
    expect(await balance(anmol)).toBe(0); // paid 7,251.00 against 7,251.00 due
  });

  it("M5: the same screenshot can't be reused, and forwarded (unverified) emails only become suggestions", async () => {
    const img = await noise();
    await handleIncoming(deps, "919876500002", { kind: "image", bytes: img, contentType: "image/png" });
    await handleIncoming(deps, "919876500002", { kind: "image", bytes: img, contentType: "image/png" });
    expect(lastText("+919876500002")).toContain("पहले भेजा जा चुका");

    const token = (await one<{ t: string }>(db, sql`select inbound_email_token as t from orgs`))!.t;
    const email = sampleCreditEmail("hdfc", { amountPaise: 50000, utr: "630600000099", payerName: "Stranger", payerVpa: "x@ybl", date: "2026-12-03" });
    const r = await receiveInboundEmail(deps, { to: `${token}@in.rentflow.app`, from: "owner@gmail.com", subject: "Fwd: alert", text: email.text, dkimVerified: true });
    expect(r).toMatchObject({ status: "parsed", decision: "none" });
    const unverified = await one<{ verified: boolean; status: string }>(db, sql`select verified, status from bank_credits where utr = '630600000099'`);
    expect(unverified).toEqual({ verified: false, status: "unmatched" });
  });

  it("M5: cash recorded by the manager only counts once the tenant confirms on WhatsApp", async () => {
    const before = await balance(anmol);
    const managerId = (await one<{ id: string }>(db, sql`select id from users where phone = '+919800000002'`))!.id;
    const manager = (await loadActor(db, managerId))!;
    const entryId = await recordCash(deps, manager, { tenancyId: anmol, amountPaise: 50000, receivedOn: "2026-12-03", note: "" });
    expect(sentTo("+919876500002").at(-1)?.message).toMatchObject({ name: "rf_cash_confirm", buttonIds: [`cash:${entryId}:yes`, `cash:${entryId}:no`] });
    expect(await balance(anmol)).toBe(before);
    await handleIncoming(deps, "919876500002", { kind: "reply", id: `cash:${entryId}:yes` });
    expect(await balance(anmol)).toBe(before - 50000);
    await handleIncoming(deps, "919876500002", { kind: "reply", id: `cash:${entryId}:yes` });
    expect(await balance(anmol)).toBe(before - 50000);
    const cashOverview = await asUserDb(db, ownerUser, (tx) => queries.cashOverview(tx, owner.orgId));
    expect(cashOverview.inHand).toEqual([{ manager: "Ravi", amountPaise: 50000, ids: [entryId] }]);
  });

  it("M6: reminders go out on the configured days, once, and stop when paid", async () => {
    // New month: January draft + approval, nobody pays.
    const [meter] = await many<{ id: string }>(db, sql`select meter_id as id from rooms where property_id = ${propertyId}`);
    await recordMeterReading(deps, owner, { meterId: meter!.id, period: "2026-12", reading: 1200, photo });
    now = new Date("2026-12-29T09:00:00+05:30");
    const daily = await runDaily(deps, "2026-12-29");
    expect(daily.draftsCreated).toBe(1);
    const [jan] = await many<{ id: string }>(db, sql`select id from billing_cycles where period = '2027-01'`);
    await approveCycle(deps, owner, jan!.id);

    const reminders = () => deps.whatsapp.sent.filter((s) => s.message.kind === "template" && s.message.name === "rf_reminder").length;
    expect((await runDaily(deps, "2027-01-03")).remindersSent).toBe(2);
    expect((await runDaily(deps, "2027-01-03")).remindersSent).toBe(0);
    expect((await runDaily(deps, "2027-01-04")).remindersSent).toBe(0);
    expect(reminders()).toBe(2);
  });

  it("M6: receipt verification tokens can't be forged", () => {
    const id = "6c1a7c58-3f0b-4e8a-9a8c-0f6ad2f1b111";
    const token = receiptToken(deps.config.receiptSecret, id);
    expect(verifyReceiptToken(deps.config.receiptSecret, token)).toBe(id);
    expect(verifyReceiptToken(deps.config.receiptSecret, `${id}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(verifyReceiptToken("other-secret", token)).toBeNull();
  });

  it("M7: check-out — notice, final bill, deposit settlement, refund confirmed on WhatsApp, bed vacant", async () => {
    now = new Date("2027-01-10T10:00:00+05:30");
    await giveNotice(deps, owner, anubhav, { noticeDate: "2027-01-01", checkOut: "2027-01-10" });
    const finalCycle = await draftFinalBill(deps, owner, anubhav, { finalReading: 1230, photo, damages: [{ description: "Broken chair", amountPaise: 50000 }] });
    await approveCycle(deps, owner, finalCycle);
    const dues = await balance(anubhav);
    expect(dues).toBeGreaterThan(0);
    const settlement = await settleDeposit(deps, owner, anubhav);
    expect(settlement.depositPaise).toBe(400000);
    expect(settlement.appliedPaise).toBe(dues);
    expect(settlement.refundPaise).toBe(400000 - dues);
    expect(sentTo("+919876500001").at(-1)?.message).toMatchObject({ name: "rf_refund_confirm", buttonIds: [`refund:${anubhav}:yes`, `refund:${anubhav}:no`] });
    await handleIncoming(deps, "919876500001", { kind: "reply", id: `refund:${anubhav}:yes` });
    const after = await one<{ status: string; bed: string }>(db, sql`select tc.status, b.status as bed from tenancies tc join beds b on b.id = tc.bed_id where tc.id = ${anubhav}`);
    expect(after).toEqual({ status: "closed", bed: "vacant" });
    expect(await balance(anubhav)).toBe(0);
  });

  it("M7: the dashboard and the collection report add up", async () => {
    const dash = await asUserDb(db, ownerUser, (tx) => queries.dashboard(tx, owner.orgId, "2026-12"));
    expect(dash.expectedPaise).toBe(286600 + 725100);
    expect(dash.unmatchedCount).toBe(1);
    // The monthly report: December's charges by type, adding up to the billed total.
    const byKind = Object.fromEntries(dash.breakdown.map((k) => [k.kind, k.paise]));
    expect(byKind).toEqual({ rent: 200000 + 266700 + 400000, metered: 57600 + 38400, fixed: 40000, service: 9000 });
    expect(dash.breakdown.reduce((s, k) => s + k.paise, 0)).toBe(dash.newChargesPaise);
    const active = await one<{ n: number }>(db, sql`select count(*)::int as n from tenancies where status in ('active', 'notice')`);
    expect(dash.activeTenants).toBe(active!.n);
    // Payments are dated by the database clock (the test's fake clock only drives "today").
    const thisMonth = periodOf(todayInIndia(new Date()));
    const live = await asUserDb(db, ownerUser, (tx) => queries.dashboard(tx, owner.orgId, thisMonth));
    expect(live.collectedCashPaise).toBe(50000);
    // Recent payments: newest first, each with how it was confirmed, adding up to what was collected.
    expect(live.recentPayments.map((r) => r.method).sort()).toEqual(expect.arrayContaining(["bank", "cash"]));
    expect(live.recentPayments.every((r) => r.paise > 0)).toBe(true);
    if (live.recentPayments.length < 8) expect(live.recentPayments.reduce((s, r) => s + r.paise, 0)).toBe(live.collectedPaise);
    const report = await asUserDb(db, ownerUser, (tx) => queries.collectionReport(tx, owner.orgId, thisMonth, 1));
    expect(report[0]).toMatchObject({ upiPaise: 286601 + 725100, cashPaise: 50000 });
    expect(report[0]!.collectedPaise).toBe(live.collectedPaise + report[0]!.depositPaise);
  });

  it("RLS: the manager sees their property's tenants but not bank credits", async () => {
    const managerUser = { id: (await one<{ id: string }>(db, sql`select id from users where phone = '+919800000002'`))!.id, phone: "919800000002" };
    const tenantsSeen = await asUserDb(db, managerUser, (tx) => queries.listTenants(tx, owner.orgId));
    expect(tenantsSeen.map((t) => t.name)).toEqual(["Anmol"]);
    const pay = await asUserDb(db, managerUser, (tx) => queries.paymentsOverview(tx, owner.orgId));
    expect(pay.unmatched).toEqual([]);
    expect(pay.matched).toEqual([]);
  });

  it("no background job failed", () => {
    expect(deps.jobs.errors).toEqual([]);
  });
});
