import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, newUser, rowsAs, type TestUser } from "./harness";

/** Tables that carry org_id, i.e. everything except orgs and users. */
const ORG_TABLES = [
  "org_members",
  "user_property_access",
  "properties",
  "floors",
  "rooms",
  "beds",
  "tenants",
  "tenancies",
  "audit_log",
] as const;
const ALL_TABLES = ["orgs", "users", ...ORG_TABLES] as const;

interface SeededProperty {
  propertyId: string;
  roomId: string;
  bedId: string;
  tenantId: string;
  tenancyId: string;
}

async function one<T>(tx: Transaction, query: string, params: unknown[] = []): Promise<T> {
  const { rows } = await tx.query<T>(query, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
  return rows[0] as T;
}

async function createOrg(db: PGlite, owner: TestUser, name: string): Promise<string> {
  return as(db, owner, async (tx) => {
    const row = await one<{ id: string }>(tx, "select public.create_owner_org($1, $2) as id", [name, "Owner"]);
    return row.id;
  });
}

/** Creates property → room → bed → tenant → tenancy as the org's owner (through RLS). */
async function seedProperty(
  db: PGlite,
  owner: TestUser,
  orgId: string,
  name: string,
  tenantPhone: string,
): Promise<SeededProperty> {
  return as(db, owner, async (tx) => {
    const { id: propertyId } = await one<{ id: string }>(
      tx,
      `insert into properties (org_id, name, due_day, upi_vpa, payee_name, electricity_rate_paise)
       values ($1, $2, 5, 'owner@okaxis', 'Owner', 800) returning id`,
      [orgId, name],
    );
    const { id: floorId } = await one<{ id: string }>(
      tx,
      "insert into floors (org_id, property_id, name, sort) values ($1, $2, 'Floor 3', 3) returning id",
      [orgId, propertyId],
    );
    const { id: roomId } = await one<{ id: string }>(
      tx,
      "insert into rooms (org_id, property_id, floor_id, number, sharing) values ($1, $2, $3, '303', 2) returning id",
      [orgId, propertyId, floorId],
    );
    const { id: bedId } = await one<{ id: string }>(
      tx,
      "insert into beds (org_id, room_id, label, default_rent_paise) values ($1, $2, 'A', 200000) returning id",
      [orgId, roomId],
    );
    const { id: tenantId } = await one<{ id: string }>(
      tx,
      "insert into tenants (org_id, name, phone) values ($1, 'Tenant', $2) returning id",
      [orgId, tenantPhone],
    );
    const { id: tenancyId } = await one<{ id: string }>(
      tx,
      `insert into tenancies (org_id, tenant_id, bed_id, rent_paise, deposit_paise, check_in)
       values ($1, $2, $3, 200000, 400000, '2026-11-01') returning id`,
      [orgId, tenantId, bedId],
    );
    return { propertyId, roomId, bedId, tenantId, tenancyId };
  });
}

let db: PGlite;
const ownerA = newUser();
const managerA = newUser();
const ownerB = newUser();
const managerB = newUser();
const stranger = newUser(); // logged in, but not part of any org
let orgA: string;
let orgB: string;
let a1: SeededProperty; // property A1 — manager A has access
let a2: SeededProperty; // property A2 — manager A has no access
let b1: SeededProperty;

beforeAll(async () => {
  db = await createTestDb();
  orgA = await createOrg(db, ownerA, "Sunrise PG");
  orgB = await createOrg(db, ownerB, "Moonlight Hostel");
  a1 = await seedProperty(db, ownerA, orgA, "Sunrise Koramangala", "+919000000001");
  a2 = await seedProperty(db, ownerA, orgA, "Sunrise HSR", "+919000000002");
  b1 = await seedProperty(db, ownerB, orgB, "Moonlight Indiranagar", "+919000000003");

  await addManager(ownerA, managerA, orgA, a1.propertyId);
  await addManager(ownerB, managerB, orgB, b1.propertyId);
}, 60_000);

async function addManager(owner: TestUser, manager: TestUser, orgId: string, propertyId: string) {
  // Manager invites arrive in M2; until then the users row is created directly.
  await db.query("insert into users (id, phone, name) values ($1, $2, 'Manager')", [manager.id, `+${manager.phone}`]);
  await as(db, owner, async (tx) => {
    await tx.query("insert into org_members (org_id, user_id, role) values ($1, $2, 'manager')", [orgId, manager.id]);
    await tx.query("insert into user_property_access (org_id, user_id, property_id) values ($1, $2, $3)", [
      orgId,
      manager.id,
      propertyId,
    ]);
  });
}

afterAll(async () => {
  await db?.close();
});

describe("owner signup (create_owner_org)", () => {
  it("creates the user, the org and an owner membership", async () => {
    const [user] = await db.query<{ phone: string; name: string }>("select phone, name from users where id = $1", [
      ownerA.id,
    ]).then((r) => r.rows);
    expect(user).toEqual({ phone: `+${ownerA.phone}`, name: "Owner" });

    const members = await rowsAs<{ org_id: string; role: string }>(db, ownerA, "select org_id, role from org_members where user_id = $1", [ownerA.id]);
    expect(members).toEqual([{ org_id: orgA, role: "owner" }]);
  });

  it("refuses to create a second org for the same owner", async () => {
    await expect(createOrg(db, ownerA, "Another PG")).rejects.toThrow(/already own/);
  });

  it("requires a business name", async () => {
    await expect(createOrg(db, newUser(), "   ")).rejects.toThrow(/Business name is required/);
  });

  it("cannot be called without logging in", async () => {
    await expect(createOrg(db, null as unknown as TestUser, "Anon PG")).rejects.toThrow(/permission denied/);
  });

  it("writes the signup to the audit log", async () => {
    const entries = await rowsAs<{ entity: string; action: string; actor_id: string }>(
      db,
      ownerA,
      "select entity, action, actor_id from audit_log where org_id = $1 and entity in ('orgs', 'org_members') order by created_at",
      [orgA],
    );
    expect(entries).toContainEqual({ entity: "orgs", action: "insert", actor_id: ownerA.id });
    expect(entries).toContainEqual({ entity: "org_members", action: "insert", actor_id: ownerA.id });
  });
});

describe("anonymous visitors", () => {
  it.each(ALL_TABLES)("cannot read %s", async (table) => {
    await expect(rowsAs(db, null, `select * from ${table}`)).rejects.toThrow(/permission denied/);
  });
});

describe("a logged-in user with no org", () => {
  it.each(ALL_TABLES.filter((t) => t !== "users"))("sees no rows in %s", async (table) => {
    expect(await rowsAs(db, stranger, `select * from ${table}`)).toHaveLength(0);
  });

  it("sees no other users", async () => {
    expect(await rowsAs(db, stranger, "select * from users")).toHaveLength(0);
  });
});

describe("org A cannot read org B (and vice versa)", () => {
  it("orgs: each owner sees only their own org", async () => {
    expect(await rowsAs(db, ownerA, "select id from orgs")).toEqual([{ id: orgA }]);
    expect(await rowsAs(db, ownerB, "select id from orgs")).toEqual([{ id: orgB }]);
  });

  it.each(ORG_TABLES)("%s: owner B sees none of org A's rows, but does see their own", async (table) => {
    const [aRows] = await db.query<{ n: number }>(`select count(*)::int as n from ${table} where org_id = $1`, [orgA]).then((r) => r.rows);
    expect(aRows?.n).toBeGreaterThan(0); // the data exists…

    const seenByB = await rowsAs<{ org_id: string }>(db, ownerB, `select org_id from ${table}`);
    expect(seenByB.length).toBeGreaterThan(0); // …B sees their own…
    expect(seenByB.every((r) => r.org_id === orgB)).toBe(true); // …and nothing of A's.

    const seenByA = await rowsAs<{ org_id: string }>(db, ownerA, `select org_id from ${table}`);
    expect(seenByA.every((r) => r.org_id === orgA)).toBe(true);
  });

  it("users: owner B cannot see org A's people", async () => {
    const ids = (await rowsAs<{ id: string }>(db, ownerB, "select id from users")).map((r) => r.id).sort();
    expect(ids).toEqual([ownerB.id, managerB.id].sort());
  });

  it("owner B cannot look up org A's rows even by id", async () => {
    expect(await rowsAs(db, ownerB, "select * from properties where id = $1", [a1.propertyId])).toHaveLength(0);
    expect(await rowsAs(db, ownerB, "select * from tenants where id = $1", [a1.tenantId])).toHaveLength(0);
    expect(await rowsAs(db, ownerB, "select * from tenancies where id = $1", [a1.tenancyId])).toHaveLength(0);
  });
});

describe("org A cannot write to org B", () => {
  it("cannot create a property in another org", async () => {
    await expect(
      rowsAs(db, ownerB, "insert into properties (org_id, name) values ($1, 'Hijack')", [orgA]),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot attach a floor to another org's property by labelling it with their own org", async () => {
    await expect(
      rowsAs(db, ownerB, "insert into floors (org_id, property_id, name, sort) values ($1, $2, 'Hijack', 9)", [orgB, a1.propertyId]),
    ).rejects.toThrow(/foreign key/);
  });

  it("cannot put their tenant on another org's bed", async () => {
    const [vacantBed] = await db
      .query<{ id: string }>("insert into beds (org_id, room_id, label) values ($1, $2, 'B') returning id", [
        orgA,
        a2.roomId,
      ])
      .then((r) => r.rows);
    await expect(
      rowsAs(
        db,
        ownerB,
        "insert into tenancies (org_id, tenant_id, bed_id, rent_paise, check_in) values ($1, $2, $3, 100, '2026-11-01')",
        [orgB, b1.tenantId, vacantBed?.id],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("cannot add themselves to another org", async () => {
    await expect(
      rowsAs(db, ownerB, "insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')", [orgA, ownerB.id]),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot grant property access in another org", async () => {
    await expect(
      rowsAs(db, ownerB, "insert into user_property_access (org_id, user_id, property_id) values ($1, $2, $3)", [
        orgA,
        ownerB.id,
        a1.propertyId,
      ]),
    ).rejects.toThrow(/row-level security|foreign key/);
  });

  it("updates and deletes against another org touch zero rows", async () => {
    const updates = [
      ["orgs", "update orgs set name = 'Hacked' where id = $1 returning id"],
      ["properties", "update properties set upi_vpa = 'attacker@ybl' where org_id = $1 returning id"],
      ["beds", "update beds set default_rent_paise = 1 where org_id = $1 returning id"],
      ["tenancies", "update tenancies set rent_paise = 1 where org_id = $1 returning id"],
      ["tenants", "delete from tenants where org_id = $1 returning id"],
      ["org_members", "delete from org_members where org_id = $1 returning id"],
    ] as const;
    for (const [, query] of updates) {
      expect(await rowsAs(db, ownerB, query, [orgA])).toHaveLength(0);
    }
    const [property] = await db.query<{ upi_vpa: string }>("select upi_vpa from properties where id = $1", [a1.propertyId]).then((r) => r.rows);
    expect(property?.upi_vpa).toBe("owner@okaxis");
  });
});

describe("manager scoping", () => {
  it("sees their org but only the properties granted to them", async () => {
    expect(await rowsAs(db, managerA, "select id from orgs")).toEqual([{ id: orgA }]);
    expect(await rowsAs(db, managerA, "select id from properties")).toEqual([{ id: a1.propertyId }]);
  });

  it.each([
    ["rooms", "roomId"],
    ["beds", "bedId"],
    ["tenants", "tenantId"],
    ["tenancies", "tenancyId"],
  ] as const)("sees %s only inside granted properties", async (table, key) => {
    const ids = (await rowsAs<{ id: string }>(db, managerA, `select id from ${table}`)).map((r) => r.id);
    expect(ids).toEqual([a1[key]]);
  });

  it("cannot change properties, prices or tenancies", async () => {
    expect(await rowsAs(db, managerA, "update properties set electricity_rate_paise = 1 returning id")).toHaveLength(0);
    expect(await rowsAs(db, managerA, "update beds set default_rent_paise = 1 returning id")).toHaveLength(0);
    expect(await rowsAs(db, managerA, "update tenancies set rent_paise = 1 returning id")).toHaveLength(0);
    await expect(
      rowsAs(db, managerA, "insert into properties (org_id, name) values ($1, 'New')", [orgA]),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot grant themselves more access or promote themselves", async () => {
    await expect(
      rowsAs(db, managerA, "insert into user_property_access (org_id, user_id, property_id) values ($1, $2, $3)", [
        orgA,
        managerA.id,
        a2.propertyId,
      ]),
    ).rejects.toThrow(/row-level security/);
    expect(
      await rowsAs(db, managerA, "update org_members set role = 'owner' where user_id = $1 returning id", [managerA.id]),
    ).toHaveLength(0);
  });

  it("cannot read the audit log", async () => {
    expect(await rowsAs(db, managerA, "select * from audit_log")).toHaveLength(0);
  });

  it("sees colleagues but not other orgs' users", async () => {
    const ids = (await rowsAs<{ id: string }>(db, managerA, "select id from users")).map((r) => r.id).sort();
    expect(ids).toEqual([ownerA.id, managerA.id].sort());
  });
});

describe("audit log", () => {
  it("records before/after and the actor for property changes", async () => {
    await as(db, ownerA, (tx) =>
      tx.query("update properties set due_day = 7 where id = $1", [a2.propertyId]),
    );
    const [entry] = await rowsAs<{ actor_id: string; before: { due_day: number }; after: { due_day: number } }>(
      db,
      ownerA,
      "select actor_id, before, after from audit_log where entity = 'properties' and entity_id = $1 and action = 'update'",
      [a2.propertyId],
    );
    expect(entry?.actor_id).toBe(ownerA.id);
    expect(entry?.before.due_day).toBe(5);
    expect(entry?.after.due_day).toBe(7);
  });

  it.each([
    ["insert", "insert into audit_log (org_id, action, entity) values ($1, 'x', 'x')"],
    ["update", "update audit_log set action = 'x' where org_id = $1"],
    ["delete", "delete from audit_log where org_id = $1"],
  ])("cannot be %sed by app users, even the owner", async (_verb, query) => {
    await expect(rowsAs(db, ownerA, query, [orgA])).rejects.toThrow(/permission denied/);
  });
});

describe("integrity guards", () => {
  it("an org can't lose its last owner", async () => {
    await expect(
      rowsAs(db, ownerA, "delete from org_members where user_id = $1", [ownerA.id]),
    ).rejects.toThrow(/at least one owner/);
    await expect(
      rowsAs(db, ownerA, "update org_members set role = 'manager' where user_id = $1", [ownerA.id]),
    ).rejects.toThrow(/at least one owner/);
  });

  it("a user can rename themselves but not change their login phone", async () => {
    await as(db, ownerA, (tx) => tx.query("update users set name = 'Anubhav' where id = $1", [ownerA.id]));
    await expect(
      rowsAs(db, ownerA, "update users set phone = '+919999999999' where id = $1", [ownerA.id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("a bed can't hold two current tenancies", async () => {
    await expect(
      as(db, ownerA, (tx) =>
        tx.query(
          "insert into tenancies (org_id, tenant_id, bed_id, rent_paise, check_in) values ($1, $2, $3, 100, '2026-11-02')",
          [orgA, a2.tenantId, a1.bedId],
        ),
      ),
    ).rejects.toThrow(/tenancies_one_open_per_bed/);
  });

  it("rejects non-E.164 tenant phones and invalid due days", async () => {
    await expect(
      as(db, ownerA, (tx) => tx.query("insert into tenants (org_id, name, phone) values ($1, 'X', '98765 43210')", [orgA])),
    ).rejects.toThrow(/tenants_phone_e164/);
    await expect(
      as(db, ownerA, (tx) => tx.query("update properties set due_day = 31 where id = $1", [a1.propertyId])),
    ).rejects.toThrow(/properties_due_day_range/);
  });

  it("deleting an org cascades cleanly (service role only)", async () => {
    const temp = newUser();
    const tempOrg = await createOrg(db, temp, "Temp PG");
    await seedProperty(db, temp, tempOrg, "Temp", "+919000000099");
    await db.query("delete from orgs where id = $1", [tempOrg]);
    const [left] = await db.query<{ n: number }>("select count(*)::int as n from properties where org_id = $1", [tempOrg]).then((r) => r.rows);
    expect(left?.n).toBe(0);
  });
});
