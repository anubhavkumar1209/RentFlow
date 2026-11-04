/**
 * Who is acting, and what they may do. Every write in the services starts with
 * one of the `require…` checks below, then runs as the database owner. Reads in
 * the web app run as the user under RLS instead (asUser), so both layers agree.
 */
import { and, eq } from "drizzle-orm";
import { orgMembers, properties, userPropertyAccess, users, type Queryable } from "@rentflow/db";

export type ManagerPermission = "manage_tenants" | "record_cash" | "enter_readings" | "edit_prices";

/** CLAUDE.md §2: managers do daily operations but can't change prices unless granted. */
export const DEFAULT_MANAGER_PERMISSIONS: Record<ManagerPermission, boolean> = {
  manage_tenants: true,
  record_cash: true,
  enter_readings: true,
  edit_prices: false,
};

export interface Actor {
  userId: string;
  name: string | null;
  phone: string;
  orgId: string;
  /** billing_staff / maintenance_staff arrive in M11; until then they are scoped like managers. */
  role: "owner" | "manager" | "billing_staff" | "maintenance_staff";
  /** Property ids a manager can work on, with their permissions. Empty for owners (they have all). */
  access: Map<string, Record<ManagerPermission, boolean>>;
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** Loads the actor for a logged-in user (their first org). Null if they haven't joined an org. */
export async function loadActor(db: Queryable, userId: string, orgId?: string): Promise<Actor | null> {
  const rows = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, name: users.name, phone: users.phone })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.active, true), orgId ? eq(orgMembers.orgId, orgId) : undefined))
    .orderBy(orgMembers.createdAt)
    .limit(1);
  const m = rows[0];
  if (!m) return null;
  const access = new Map<string, Record<ManagerPermission, boolean>>();
  if (m.role !== "owner") {
    const grants = await db
      .select({ propertyId: userPropertyAccess.propertyId, permissions: userPropertyAccess.permissions })
      .from(userPropertyAccess)
      .where(and(eq(userPropertyAccess.userId, userId), eq(userPropertyAccess.orgId, m.orgId)));
    for (const g of grants) {
      access.set(g.propertyId, { ...DEFAULT_MANAGER_PERMISSIONS, ...(g.permissions as Partial<Record<ManagerPermission, boolean>>) });
    }
  }
  return { userId, name: m.name, phone: m.phone, orgId: m.orgId, role: m.role, access };
}

export function isOwner(actor: Actor): boolean {
  return actor.role === "owner";
}

export function requireOwner(actor: Actor): void {
  if (actor.role !== "owner") throw new ForbiddenError("Only the owner can do this.");
}

/** Owner, or a manager with this permission on this property. */
export function can(actor: Actor, propertyId: string, permission?: ManagerPermission): boolean {
  if (actor.role === "owner") return true;
  const perms = actor.access.get(propertyId);
  return Boolean(perms && (!permission || perms[permission]));
}

export function requireProperty(actor: Actor, propertyId: string, permission?: ManagerPermission): void {
  if (!can(actor, propertyId, permission)) throw new ForbiddenError();
}

/** Confirms the property belongs to the actor's org (defence in depth on top of `can`). */
export async function assertPropertyInOrg(db: Queryable, actor: Actor, propertyId: string): Promise<void> {
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.orgId, actor.orgId)));
  if (!row) throw new ForbiddenError();
}

export function propertyIdsFor(actor: Actor): string[] | "all" {
  return actor.role === "owner" ? "all" : [...actor.access.keys()];
}
