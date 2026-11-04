import type { PGlite } from "@electric-sql/pglite";
import { TEMPLATES, WHATSAPP_LANGUAGES } from "@rentflow/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, newUser, rowsAs, type TestUser } from "./harness";

/** Phase 1 tables: read-only for app users, scoped by org and (for managers) property. */
const TABLES = [
  "services",
  "meters",
  "meter_readings",
  "billing_cycles",
  "bills",
  "bill_lines",
  "ledger_entries",
  "bank_credits",
  "inbound_emails",
  "payment_claims",
  "payment_matches",
  "cash_entries",
  "receipts",
  "payer_aliases",
  "conversations",
  "message_log",
] as const;
const OWNER_ONLY = new Set(["bank_credits", "inbound_emails", "payment_matches", "payer_aliases", "conversations", "message_log"]);

let db: PGlite;
const ownerA = newUser();
const managerA = newUser();
const ownerB = newUser();

interface Seed {
  orgId: string;
  propertyId: string;
  tenancyId: string;
  billId: string;
  cycleId: string;
}

async function q<T = Record<string, unknown>>(sqlText: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sqlText, params);
  return rows[0] as T;
}

/** Seeds one org with one row in every Phase 1 table, as the server would (database owner). */
async function seedOrg(owner: TestUser, name: string, phone: string): Promise<Seed & { property2Id: string }> {
  const { id: orgId } = await as(db, owner, async (tx) => (await tx.query<{ id: string }>("select public.create_owner_org($1, 'Owner') as id", [name])).rows[0]!);
  const seedProperty = async (pname: string, tphone: string) => {
    const { id: propertyId } = await q<{ id: string }>("insert into properties (org_id, name) values ($1, $2) returning id", [orgId, pname]);
    const { id: meterId } = await q<{ id: string }>("insert into meters (org_id, property_id, name) values ($1, $2, 'Room 101') returning id", [orgId, propertyId]);
    const { id: floorId } = await q<{ id: string }>("insert into floors (org_id, property_id, name, sort) values ($1, $2, 'Floor 1', 1) returning id", [orgId, propertyId]);
    const { id: roomId } = await q<{ id: string }>("insert into rooms (org_id, property_id, floor_id, number, sharing, meter_id) values ($1, $2, $3, '101', 1, $4) returning id", [orgId, propertyId, floorId, meterId]);
    const { id: bedId } = await q<{ id: string }>("insert into beds (org_id, room_id, label) values ($1, $2, 'A') returning id", [orgId, roomId]);
    const { id: tenantId } = await q<{ id: string }>("insert into tenants (org_id, name, phone) values ($1, 'T', $2) returning id", [orgId, tphone]);
    const { id: tenancyId } = await q<{ id: string }>("insert into tenancies (org_id, tenant_id, bed_id, rent_paise, check_in) values ($1, $2, $3, 500000, '2026-10-01') returning id", [orgId, tenantId, bedId]);
    await q("insert into services (org_id, property_id, name, type, config) values ($1, $2, 'Wi-Fi', 'fixed', '{\"amount_paise\":20000}')", [orgId, propertyId]);
    await q("insert into meter_readings (org_id, meter_id, period, reading_date, reading) values ($1, $2, '2026-10', '2026-10-31', 100)", [orgId, meterId]);
    const { id: cycleId } = await q<{ id: string }>("insert into billing_cycles (org_id, property_id, period, due_date) values ($1, $2, '2026-11', '2026-11-05') returning id", [orgId, propertyId]);
    const { id: billId } = await q<{ id: string }>("insert into bills (org_id, tenancy_id, cycle_id, total_paise, payable_paise) values ($1, $2, $3, 520000, 520001) returning id", [orgId, tenancyId, cycleId]);
    await q("insert into bill_lines (org_id, bill_id, kind, description, amount_paise) values ($1, $2, 'rent', 'Rent', 500000)", [orgId, billId]);
    await q("insert into ledger_entries (org_id, tenancy_id, type, amount_paise) values ($1, $2, 'charge', 520000)", [orgId, tenancyId]);
    const { id: creditId } = await q<{ id: string }>("insert into bank_credits (org_id, source, amount_paise, utr, credited_at) values ($1, 'email', 520001, $2, now()) returning id", [orgId, `UTR${tphone}`]);
    await q("insert into inbound_emails (org_id, from_address, status) values ($1, 'alerts@hdfcbank.net', 'parsed')", [orgId]);
    const { id: claimId } = await q<{ id: string }>("insert into payment_claims (org_id, tenancy_id, screenshot_ref, image_hash) values ($1, $2, 'x', $3) returning id", [orgId, tenancyId, `hash${tphone}`]);
    const { id: matchId } = await q<{ id: string }>("insert into payment_matches (org_id, credit_id, bill_id, claim_id, method, amount_paise) values ($1, $2, $3, $4, 'unique_amount', 520001) returning id", [orgId, creditId, billId, claimId]);
    const { id: cashId } = await q<{ id: string }>("insert into cash_entries (org_id, tenancy_id, amount_paise, received_on, recorded_by) values ($1, $2, 100, '2026-11-01', $3) returning id", [orgId, tenancyId, owner.id]);
    await q("insert into receipts (org_id, tenancy_id, payment_match_id, number, amount_paise) values ($1, $2, $3, $4, 520001)", [orgId, tenancyId, matchId, `R-${tphone}`]);
    await q("insert into receipts (org_id, tenancy_id, cash_entry_id, number, amount_paise) values ($1, $2, $3, $4, 100)", [orgId, tenancyId, cashId, `C-${tphone}`]);
    await q("insert into payer_aliases (org_id, tenancy_id, payer_vpa) values ($1, $2, 'x@ybl')", [orgId, tenancyId]);
    await q("insert into conversations (org_id, phone, tenancy_id) values ($1, $2, $3)", [orgId, tphone, tenancyId]);
    await q("insert into message_log (org_id, phone, tenancy_id, direction, payload) values ($1, $2, $3, 'out', '{}')", [orgId, tphone, tenancyId]);
    return { propertyId, tenancyId, billId, cycleId };
  };
  const first = await seedProperty(`${name} One`, phone);
  const second = await seedProperty(`${name} Two`, phone.replace(/1$/, "2"));
  return { orgId, ...first, property2Id: second.propertyId };
}

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  db = await createTestDb();
  a = await seedOrg(ownerA, "Sunrise", "+919100000001");
  b = await seedOrg(ownerB, "Moonlight", "+919200000001");
  await db.query("insert into users (id, phone) values ($1, $2)", [managerA.id, `+${managerA.phone}`]);
  await db.query("insert into org_members (org_id, user_id, role) values ($1, $2, 'manager')", [a.orgId, managerA.id]);
  await db.query("insert into user_property_access (org_id, user_id, property_id) values ($1, $2, $3)", [a.orgId, managerA.id, a.propertyId]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("phase 1 tables: org isolation", () => {
  it.each(TABLES)("%s: each owner sees only their own org's rows", async (table) => {
    const seenByA = await rowsAs<{ org_id: string }>(db, ownerA, `select org_id from ${table}`);
    const seenByB = await rowsAs<{ org_id: string }>(db, ownerB, `select org_id from ${table}`);
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByB.length).toBeGreaterThan(0);
    expect(seenByA.every((r) => r.org_id === a.orgId)).toBe(true);
    expect(seenByB.every((r) => r.org_id === b.orgId)).toBe(true);
  });

  it.each(TABLES)("%s: app users can't write, even to their own org", async (table) => {
    await expect(rowsAs(db, ownerA, `delete from ${table} where org_id = $1`, [a.orgId])).rejects.toThrow(/permission denied/);
    await expect(rowsAs(db, ownerA, `update ${table} set org_id = org_id where org_id = $1`, [a.orgId])).rejects.toThrow(/permission denied/);
  });
});

describe("phase 1 tables: manager scoping", () => {
  it.each(TABLES)("%s: manager sees only rows of granted properties (or none, for owner-only tables)", async (table) => {
    const rows = await rowsAs(db, managerA, `select * from ${table}`);
    if (OWNER_ONLY.has(table)) {
      expect(rows).toHaveLength(0);
    } else {
      const ownerRows = await rowsAs(db, ownerA, `select * from ${table}`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(ownerRows.length);
    }
  });
});

describe("money guarantees", () => {
  it("ledger entries can't be updated or deleted, even by the database owner", async () => {
    await expect(db.query("update ledger_entries set amount_paise = 1 where org_id = $1", [a.orgId])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from ledger_entries where org_id = $1", [a.orgId])).rejects.toThrow(/append-only/);
  });

  it("bill lines of an approved cycle are locked", async () => {
    await db.query("update billing_cycles set status = 'approved' where id = $1", [a.cycleId]);
    await expect(db.query("update bill_lines set amount_paise = 1 where bill_id = $1", [a.billId])).rejects.toThrow(/locked/);
    await expect(db.query("insert into bill_lines (org_id, bill_id, kind, description, amount_paise) values ($1, $2, 'adjustment', 'x', 1)", [a.orgId, a.billId])).rejects.toThrow(/locked/);
  });

  it("two bills in a cycle can't share a payable amount, and a UTR is recorded once per org", async () => {
    const { id: tenancy2 } = await q<{ id: string }>("select t.id from tenancies t join beds b on b.id = t.bed_id join rooms r on r.id = b.room_id where r.property_id = $1", [a.property2Id]);
    await expect(db.query("insert into bills (org_id, tenancy_id, cycle_id, total_paise, payable_paise) values ($1, $2, $3, 520000, 520001)", [a.orgId, tenancy2, a.cycleId])).rejects.toThrow(/bills_unique_payable/);
    await expect(db.query("insert into bank_credits (org_id, source, amount_paise, utr, credited_at) values ($1, 'email', 5, 'UTR+919100000001', now())", [a.orgId])).rejects.toThrow(/bank_credits_org_utr/);
  });

  it("a receipt needs exactly one confirmed payment behind it", async () => {
    await expect(db.query("insert into receipts (org_id, tenancy_id, number, amount_paise) values ($1, $2, 'X1', 100)", [a.orgId, a.tenancyId])).rejects.toThrow(/receipts_one_source/);
  });

  it("deleting an org still cascades through the append-only ledger", async () => {
    const temp = newUser();
    const t = await seedOrg(temp, "Temp", "+919300000001");
    await db.query("delete from orgs where id = $1", [t.orgId]);
    expect((await q<{ n: number }>("select count(*)::int as n from ledger_entries where org_id = $1", [t.orgId])).n).toBe(0);
  });
});

describe("message templates", () => {
  it("the seeded templates match packages/core exactly", async () => {
    const { rows } = await db.query<{ name: string; language: "en" | "hi"; body: string; variables: number; buttons: string[] }>(
      "select name, language, body, variables, buttons from message_templates",
    );
    const expected = Object.entries(TEMPLATES).flatMap(([name, def]) =>
      WHATSAPP_LANGUAGES.map((language) => ({ name, language, body: def.body[language], variables: def.variables, buttons: def.buttons[language] })),
    );
    const sort = <T extends { name: string; language: string }>(x: T[]) => [...x].sort((p, q2) => `${p.name}${p.language}`.localeCompare(`${q2.name}${q2.language}`));
    expect(sort(rows)).toEqual(sort(expected));
  });
});
