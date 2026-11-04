/**
 * M2: property, rooms, tenants and staff setup.
 */
import {
  isISODate,
  isE164,
  normalizePhone,
  planRooms,
  validateTenantImport,
  type ImportBed,
  type ImportError,
} from "@rentflow/core";
import type { Language } from "@rentflow/core";
import {
  beds,
  floors,
  ledgerEntries,
  meters,
  orgMembers,
  properties,
  rooms,
  services,
  tenancies,
  tenants,
  userPropertyAccess,
  users,
  type Tx,
} from "@rentflow/db";
import { and, eq, sql } from "drizzle-orm";
import {
  assertPropertyInOrg,
  DEFAULT_MANAGER_PERMISSIONS,
  ForbiddenError,
  requireOwner,
  requireProperty,
  UserError,
  type Actor,
  type ManagerPermission,
} from "../actor";
import type { AppDeps } from "../ports";
import { many } from "../sql";

// ─── Properties ─────────────────────────────────────────────────────────────

export interface PropertyInput {
  name: string;
  address: string | null;
  dueDay: number;
  upiVpa: string | null;
  payeeName: string | null;
  electricityRatePaise: number | null;
  lateFeeRule?: { amount_paise: number; grace_days: number } | null;
  /** Mobile number linked to the UPI ID (optional), shown on bills. Undefined = leave unchanged. */
  upiPhone?: string | null;
}

/** "+91 98765-43210" → "9876543210"; null when empty; throws when it isn't a 10-digit Indian mobile. */
function cleanUpiPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (!digits) return null;
  if (!/^[6-9]\d{9}$/.test(digits)) throw new UserError("UPI number should be a 10-digit mobile number.");
  return digits;
}

function validateProperty(input: PropertyInput): void {
  if (!input.name.trim()) throw new UserError("Enter the property name.");
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) throw new UserError("Rent due day must be between 1 and 28.");
  if (input.upiVpa && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(input.upiVpa)) {
    throw new UserError("UPI ID should look like name@bank (for example sunrisepg@okaxis).");
  }
  if (input.electricityRatePaise !== null && (!Number.isSafeInteger(input.electricityRatePaise) || input.electricityRatePaise < 0)) {
    throw new UserError("Electricity rate must be a positive amount.");
  }
}

export async function createProperty(deps: AppDeps, actor: Actor, input: PropertyInput): Promise<string> {
  requireOwner(actor);
  validateProperty(input);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(properties)
      .values({
        orgId: actor.orgId,
        name: input.name.trim(),
        address: input.address?.trim() || null,
        dueDay: input.dueDay,
        upiVpa: input.upiVpa?.trim() || null,
        payeeName: input.payeeName?.trim() || null,
        electricityRatePaise: input.electricityRatePaise,
        lateFeeRule: input.lateFeeRule ?? null,
        upiPhone: cleanUpiPhone(input.upiPhone),
      })
      .returning({ id: properties.id });
    if (!row) throw new Error("insert failed");
    await tx.insert(services).values({ orgId: actor.orgId, propertyId: row.id, name: "Electricity", type: "metered", menuOrder: 0 });
    return row.id;
  });
}

export async function updateProperty(deps: AppDeps, actor: Actor, propertyId: string, input: PropertyInput): Promise<void> {
  requireProperty(actor, propertyId, "edit_prices");
  await assertPropertyInOrg(deps.db, actor, propertyId);
  validateProperty(input);
  await deps.db
    .update(properties)
    .set({
      name: input.name.trim(),
      address: input.address?.trim() || null,
      dueDay: input.dueDay,
      upiVpa: input.upiVpa?.trim() || null,
      payeeName: input.payeeName?.trim() || null,
      electricityRatePaise: input.electricityRatePaise,
      lateFeeRule: input.lateFeeRule ?? null,
      ...(input.upiPhone !== undefined ? { upiPhone: cleanUpiPhone(input.upiPhone) } : {}),
    })
    .where(and(eq(properties.id, propertyId), eq(properties.orgId, actor.orgId)));
}

/** Fixed monthly charges (Wi-Fi, maintenance…). Replaces the whole list. */
export async function setFixedCharges(
  deps: AppDeps,
  actor: Actor,
  propertyId: string,
  charges: { id?: string; name: string; amountPaise: number; active: boolean }[],
): Promise<void> {
  requireProperty(actor, propertyId, "edit_prices");
  await assertPropertyInOrg(deps.db, actor, propertyId);
  for (const c of charges) {
    if (!c.name.trim()) throw new UserError("Every charge needs a name.");
    if (!Number.isSafeInteger(c.amountPaise) || c.amountPaise <= 0) throw new UserError(`Enter an amount for ${c.name}.`);
  }
  await deps.db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.propertyId, propertyId), eq(services.orgId, actor.orgId), eq(services.type, "fixed")));
    const keep = new Set(charges.filter((c) => c.id).map((c) => c.id));
    // Services are referenced by old bill lines, so they're switched off rather than deleted.
    for (const e of existing) {
      if (!keep.has(e.id)) await tx.update(services).set({ active: false }).where(eq(services.id, e.id));
    }
    for (const [i, c] of charges.entries()) {
      const values = { name: c.name.trim(), active: c.active, config: { amount_paise: c.amountPaise }, menuOrder: i + 1 };
      if (c.id && existing.some((e) => e.id === c.id)) await tx.update(services).set(values).where(eq(services.id, c.id));
      else await tx.insert(services).values({ orgId: actor.orgId, propertyId, type: "fixed", ...values });
    }
  });
}

// ─── Rooms & beds ───────────────────────────────────────────────────────────

export interface GenerateRoomsInput {
  floorFrom: number;
  floorTo: number;
  roomsPerFloor: number;
  sharing: number;
  startAt?: number;
  defaultRentPaise: number;
}

/** "Floors 1–3, rooms 101–110, 2-sharing". Existing room numbers are skipped. Each room gets its own meter. */
export async function generateRooms(deps: AppDeps, actor: Actor, propertyId: string, input: GenerateRoomsInput): Promise<{ created: number; skipped: string[] }> {
  requireOwner(actor);
  await assertPropertyInOrg(deps.db, actor, propertyId);
  let plan;
  try {
    plan = planRooms(input);
  } catch (err) {
    throw new UserError((err as Error).message);
  }
  if (!Number.isSafeInteger(input.defaultRentPaise) || input.defaultRentPaise < 0) throw new UserError("Enter the default rent per bed.");
  return deps.db.transaction(async (tx) => {
    const existing = new Set(
      (await tx.select({ number: rooms.number }).from(rooms).where(eq(rooms.propertyId, propertyId))).map((r) => r.number.toLowerCase()),
    );
    const skipped: string[] = [];
    let created = 0;
    const floorIds = new Map<number, string>();
    for (const room of plan) {
      if (!floorIds.has(room.floor)) {
        const name = room.floor === 0 ? "Ground floor" : `Floor ${room.floor}`;
        const [floor] = await tx
          .insert(floors)
          .values({ orgId: actor.orgId, propertyId, name, sort: room.floor })
          .onConflictDoUpdate({ target: [floors.propertyId, floors.sort], set: { updatedAt: sql`now()` } })
          .returning({ id: floors.id });
        if (!floor) throw new Error("insert failed");
        floorIds.set(room.floor, floor.id);
      }
      if (existing.has(room.number.toLowerCase())) {
        skipped.push(room.number);
        continue;
      }
      const [meter] = await tx.insert(meters).values({ orgId: actor.orgId, propertyId, scope: "room", name: `Room ${room.number}` }).returning({ id: meters.id });
      const [r] = await tx
        .insert(rooms)
        .values({ orgId: actor.orgId, propertyId, floorId: floorIds.get(room.floor) as string, number: room.number, sharing: room.sharing, meterId: meter?.id ?? null })
        .returning({ id: rooms.id });
      if (!r) throw new Error("insert failed");
      await tx.insert(beds).values(room.beds.map((label) => ({ orgId: actor.orgId, roomId: r.id, label, defaultRentPaise: input.defaultRentPaise })));
      created += 1;
    }
    return { created, skipped };
  });
}

export async function updateBed(deps: AppDeps, actor: Actor, bedId: string, input: { defaultRentPaise?: number; blocked?: boolean }): Promise<void> {
  const [bed] = await many<{ property_id: string; status: string }>(
    deps.db,
    sql`select r.property_id, b.status from beds b join rooms r on r.id = b.room_id where b.id = ${bedId} and b.org_id = ${actor.orgId}`,
  );
  if (!bed) throw new ForbiddenError();
  requireProperty(actor, bed.property_id, "edit_prices");
  const patch: Partial<typeof beds.$inferInsert> = {};
  if (input.defaultRentPaise !== undefined) {
    if (!Number.isSafeInteger(input.defaultRentPaise) || input.defaultRentPaise < 0) throw new UserError("Invalid rent.");
    patch.defaultRentPaise = input.defaultRentPaise;
  }
  if (input.blocked !== undefined) {
    if (input.blocked && bed.status !== "vacant") throw new UserError("Only a vacant bed can be blocked.");
    if (!input.blocked && bed.status !== "blocked") throw new UserError("This bed isn't blocked.");
    patch.status = input.blocked ? "blocked" : "vacant";
  }
  await deps.db.update(beds).set(patch).where(eq(beds.id, bedId));
}

// ─── Tenants ────────────────────────────────────────────────────────────────

export interface TenantInput {
  propertyId: string;
  bedId: string;
  name: string;
  phone: string;
  rentPaise: number;
  depositPaise: number;
  /** Record the deposit as already collected (adds it to the deposit held). */
  depositReceived: boolean;
  checkIn: string;
  guardianPhones: string[];
  language: Language;
}

/** Adds a tenant on a vacant bed, then queues the WhatsApp welcome. */
export async function addTenant(deps: AppDeps, actor: Actor, input: TenantInput): Promise<string> {
  requireProperty(actor, input.propertyId, "manage_tenants");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new UserError("Enter a valid WhatsApp number.");
  const guardians = input.guardianPhones.map((g) => normalizePhone(g));
  if (guardians.some((g) => !g)) throw new UserError("A guardian phone number isn't valid.");
  if (!input.name.trim()) throw new UserError("Enter the tenant's name.");
  if (!isISODate(input.checkIn)) throw new UserError("Enter the check-in date.");
  if (!Number.isSafeInteger(input.rentPaise) || input.rentPaise <= 0) throw new UserError("Enter the monthly rent.");
  if (!Number.isSafeInteger(input.depositPaise) || input.depositPaise < 0) throw new UserError("Enter a valid deposit.");

  const tenancyId = await deps.db.transaction((tx) =>
    insertTenancy(tx, actor, { ...input, phone, guardianPhones: guardians as string[] }),
  );
  await deps.jobs.send("welcome.send", { tenancyId });
  return tenancyId;
}

async function insertTenancy(tx: Tx, actor: Actor, input: TenantInput & { phone: string }): Promise<string> {
  const [bed] = await many<{ id: string; status: string; property_id: string }>(
    tx,
    sql`select b.id, b.status, r.property_id from beds b join rooms r on r.id = b.room_id
        where b.id = ${input.bedId} and b.org_id = ${actor.orgId} for update of b`,
  );
  if (!bed || bed.property_id !== input.propertyId) throw new ForbiddenError();
  if (bed.status !== "vacant") throw new UserError("That bed isn't vacant any more.");

  const current = await many<{ id: string }>(
    tx,
    sql`select tc.id from tenancies tc join tenants t on t.id = tc.tenant_id
        where t.org_id = ${actor.orgId} and t.phone = ${input.phone} and tc.status in ('active', 'notice')`,
  );
  if (current.length > 0) throw new UserError(`${input.phone} already has a current stay in your PG.`);

  const [tenant] = await tx
    .insert(tenants)
    .values({ orgId: actor.orgId, name: input.name.trim(), phone: input.phone, guardianPhones: input.guardianPhones, language: input.language })
    .onConflictDoUpdate({
      target: [tenants.orgId, tenants.phone],
      set: { name: input.name.trim(), guardianPhones: input.guardianPhones, language: input.language },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error("insert failed");

  const [tenancy] = await tx
    .insert(tenancies)
    .values({
      orgId: actor.orgId,
      tenantId: tenant.id,
      bedId: bed.id,
      rentPaise: input.rentPaise,
      depositPaise: input.depositPaise,
      checkIn: input.checkIn,
    })
    .returning({ id: tenancies.id });
  if (!tenancy) throw new Error("insert failed");
  await tx.update(beds).set({ status: "occupied" }).where(eq(beds.id, bed.id));
  if (input.depositReceived && input.depositPaise > 0) {
    await tx.insert(ledgerEntries).values({
      orgId: actor.orgId,
      tenancyId: tenancy.id,
      type: "deposit_in",
      amountPaise: input.depositPaise,
      refType: "tenancy",
      refId: tenancy.id,
      note: "Deposit received at check-in",
      createdBy: actor.userId,
    });
  }
  return tenancy.id;
}

export async function updateTenant(
  deps: AppDeps,
  actor: Actor,
  tenancyId: string,
  input: { name: string; guardianPhones: string[]; language: Language; rentPaise: number; depositPaise: number },
): Promise<void> {
  const [row] = await many<{ tenant_id: string; property_id: string; rent_paise: unknown; deposit_paise: unknown }>(
    deps.db,
    sql`select tc.tenant_id, r.property_id, tc.rent_paise, tc.deposit_paise from tenancies tc
        join beds b on b.id = tc.bed_id join rooms r on r.id = b.room_id
        where tc.id = ${tenancyId} and tc.org_id = ${actor.orgId}`,
  );
  if (!row) throw new ForbiddenError();
  requireProperty(actor, row.property_id, "manage_tenants");
  const priceChanged = Number(row.rent_paise) !== input.rentPaise || Number(row.deposit_paise) !== input.depositPaise;
  if (priceChanged) requireProperty(actor, row.property_id, "edit_prices");
  const guardians = input.guardianPhones.map((g) => normalizePhone(g));
  if (guardians.some((g) => !g)) throw new UserError("A guardian phone number isn't valid.");
  if (!input.name.trim()) throw new UserError("Enter the tenant's name.");
  if (!Number.isSafeInteger(input.rentPaise) || input.rentPaise <= 0) throw new UserError("Enter the monthly rent.");
  await deps.db.transaction(async (tx) => {
    await tx.update(tenants).set({ name: input.name.trim(), guardianPhones: guardians as string[], language: input.language }).where(eq(tenants.id, row.tenant_id));
    if (priceChanged) {
      // New rent applies to future bills; approved bills are never changed (§7.4).
      await tx.update(tenancies).set({ rentPaise: input.rentPaise, depositPaise: input.depositPaise }).where(eq(tenancies.id, tenancyId));
    }
  });
}

export async function recordDepositReceived(deps: AppDeps, actor: Actor, tenancyId: string, amountPaise: number): Promise<void> {
  requireOwner(actor);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new UserError("Enter the deposit amount.");
  const [t] = await deps.db.select({ id: tenancies.id }).from(tenancies).where(and(eq(tenancies.id, tenancyId), eq(tenancies.orgId, actor.orgId)));
  if (!t) throw new ForbiddenError();
  await deps.db.insert(ledgerEntries).values({
    orgId: actor.orgId,
    tenancyId,
    type: "deposit_in",
    amountPaise,
    refType: "tenancy",
    refId: tenancyId,
    note: "Deposit received",
    createdBy: actor.userId,
  });
}

/** Beds of a property in the shape the CSV validator wants. */
export async function importBeds(deps: AppDeps, actor: Actor, propertyId: string): Promise<{ beds: ImportBed[]; phones: Set<string> }> {
  requireProperty(actor, propertyId, "manage_tenants");
  const bedRows = await many<{ bed_id: string; room_number: string; label: string; status: string; default_rent_paise: unknown }>(
    deps.db,
    sql`select b.id as bed_id, r.number as room_number, b.label, b.status, b.default_rent_paise
        from beds b join rooms r on r.id = b.room_id where r.property_id = ${propertyId} and b.org_id = ${actor.orgId}
        order by r.number, b.label`,
  );
  const phoneRows = await many<{ phone: string }>(
    deps.db,
    sql`select t.phone from tenancies tc join tenants t on t.id = tc.tenant_id
        where tc.org_id = ${actor.orgId} and tc.status in ('active', 'notice')`,
  );
  return {
    beds: bedRows.map((b) => ({ bedId: b.bed_id, roomNumber: b.room_number, label: b.label, vacant: b.status === "vacant", defaultRentPaise: Number(b.default_rent_paise) })),
    phones: new Set(phoneRows.map((p) => p.phone)),
  };
}

/** CSV/Excel import: all rows are validated first; nothing is written unless every row is valid. */
export async function importTenants(
  deps: AppDeps,
  actor: Actor,
  propertyId: string,
  rows: Record<string, string>[],
  options: { depositReceived: boolean; dryRun: boolean },
): Promise<{ imported: number; errors: ImportError[]; preview: { row: number; name: string; phone: string; bed: string }[] }> {
  const ctx = await importBeds(deps, actor, propertyId);
  const { ok, errors } = validateTenantImport(rows, { beds: ctx.beds, phonesWithCurrentTenancy: ctx.phones });
  const preview = ok.map((r) => ({ row: r.row, name: r.name, phone: r.phone, bed: `${r.roomNumber}${r.bedLabel}` }));
  if (errors.length > 0 || options.dryRun || ok.length === 0) return { imported: 0, errors, preview };
  const ids = await deps.db.transaction(async (tx) => {
    const created: string[] = [];
    for (const r of ok) {
      created.push(
        await insertTenancy(tx, actor, {
          propertyId,
          bedId: r.bedId,
          name: r.name,
          phone: r.phone,
          rentPaise: r.rentPaise,
          depositPaise: r.depositPaise,
          depositReceived: options.depositReceived,
          checkIn: r.checkIn,
          guardianPhones: r.guardianPhones,
          language: r.language,
        }),
      );
    }
    return created;
  });
  for (const tenancyId of ids) await deps.jobs.send("welcome.send", { tenancyId });
  return { imported: ids.length, errors: [], preview };
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export async function addManager(
  deps: AppDeps,
  actor: Actor,
  input: { name: string; phone: string; propertyIds: string[]; permissions: Partial<Record<ManagerPermission, boolean>> },
): Promise<void> {
  requireOwner(actor);
  const phone = normalizePhone(input.phone);
  if (!phone || !isE164(phone)) throw new UserError("Enter a valid mobile number.");
  if (!input.name.trim()) throw new UserError("Enter the manager's name.");
  if (input.propertyIds.length === 0) throw new UserError("Pick at least one property.");
  for (const id of input.propertyIds) await assertPropertyInOrg(deps.db, actor, id);

  const userId = await deps.authAdmin.ensureUser(phone);
  await deps.db.transaction(async (tx) => {
    const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone));
    if (existingUser && existingUser.id !== userId) throw new UserError("This number belongs to a different login. Contact support.");
    await tx.insert(users).values({ id: userId, phone, name: input.name.trim() }).onConflictDoNothing();
    const [member] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, actor.orgId), eq(orgMembers.userId, userId)));
    if (member?.role === "owner") throw new UserError("That's an owner of this business.");
    if (!member) await tx.insert(orgMembers).values({ orgId: actor.orgId, userId, role: "manager" });
    await replaceAccess(tx, actor.orgId, userId, input.propertyIds, input.permissions);
  });
}

export async function updateManagerAccess(
  deps: AppDeps,
  actor: Actor,
  userId: string,
  propertyIds: string[],
  permissions: Partial<Record<ManagerPermission, boolean>>,
): Promise<void> {
  requireOwner(actor);
  for (const id of propertyIds) await assertPropertyInOrg(deps.db, actor, id);
  await deps.db.transaction(async (tx) => {
    const [member] = await tx.select({ role: orgMembers.role }).from(orgMembers).where(and(eq(orgMembers.orgId, actor.orgId), eq(orgMembers.userId, userId)));
    if (member?.role !== "manager") throw new ForbiddenError();
    await replaceAccess(tx, actor.orgId, userId, propertyIds, permissions);
  });
}

export async function removeManager(deps: AppDeps, actor: Actor, userId: string): Promise<void> {
  requireOwner(actor);
  await deps.db.delete(orgMembers).where(and(eq(orgMembers.orgId, actor.orgId), eq(orgMembers.userId, userId), eq(orgMembers.role, "manager")));
}

async function replaceAccess(tx: Tx, orgId: string, userId: string, propertyIds: string[], permissions: Partial<Record<ManagerPermission, boolean>>) {
  const perms = { ...DEFAULT_MANAGER_PERMISSIONS, ...permissions };
  await tx.delete(userPropertyAccess).where(and(eq(userPropertyAccess.orgId, orgId), eq(userPropertyAccess.userId, userId)));
  if (propertyIds.length > 0) {
    await tx.insert(userPropertyAccess).values(propertyIds.map((propertyId) => ({ orgId, userId, propertyId, permissions: perms })));
  }
}

