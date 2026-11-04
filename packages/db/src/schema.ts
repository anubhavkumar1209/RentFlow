/**
 * Phase 1 tables (CLAUDE.md §6). Conventions:
 * - Money is integer paise in `bigint` columns (mode "number": exact up to ~₹90 lakh crore).
 * - Every org-owned table has `org_id`. Child tables reference their parent with a
 *   composite (id, org_id) foreign key, so a row can never point at another org's data.
 * - RLS policies, grants, triggers and functions live in the hand-written
 *   migration `0001_rls_and_functions.sql`, not here.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const orgId = () => uuid("org_id").notNull();
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
const paise = (name: string) => bigint(name, { mode: "number" });

export const memberRole = pgEnum("member_role", ["owner", "manager", "billing_staff", "maintenance_staff"]);
export const whatsappMode = pgEnum("whatsapp_mode", ["shared", "own"]);
export const bedStatus = pgEnum("bed_status", ["vacant", "occupied", "notice", "blocked"]);
export const tenancyStatus = pgEnum("tenancy_status", ["active", "notice", "closed"]);
/** Must match LANGUAGE_CODES in packages/core/src/languages.ts (English + 12 Indian languages). */
export const language = pgEnum("language", ["en", "hi", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "or", "ur", "as"]);
export const propertyStatus = pgEnum("property_status", ["setting_up", "active", "paused"]);
export const tenantStatus = pgEnum("tenant_status", ["active", "archived"]);

// ─── Org ────────────────────────────────────────────────────────────────────

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  whatsappMode: whatsappMode("whatsapp_mode").notNull().default("shared"),
  /** Secret part of the org's inbound address for forwarded bank alerts: <token>@in.rentflow.app */
  inboundEmailToken: text("inbound_email_token")
    .notNull()
    .unique()
    .default(sql`substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)`),
  /** Last receipt number issued; incremented atomically per receipt. */
  receiptSeq: integer("receipt_seq").notNull().default(0),
  ...timestamps(),
});

/**
 * One row per person who logs in to the web app. `id` equals Supabase's
 * `auth.users.id`. Users are global (one person can belong to several orgs),
 * so this table has no org_id; org membership lives in `org_members`.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    phone: text("phone").notNull().unique(),
    name: text("name"),
    email: text("email"),
    /** App language for this person (the tenant-facing language lives on tenants). */
    language: language("language").notNull().default("en"),
    ...timestamps(),
  },
  (t) => [check("users_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    /** Inactive members keep their history but can't log in to this org. */
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique("org_members_org_user").on(t.orgId, t.userId), index("org_members_user_idx").on(t.userId)],
);

// ─── Property ───────────────────────────────────────────────────────────────

export const properties = pgTable(
  "properties",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    contactPhone: text("contact_phone"),
    /** setting_up until onboarding is finished; paused = no cycles, no reminders (data kept). */
    status: propertyStatus("status").notNull().default("setting_up"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    // TODO(M3): billing fields below move to property_billing_settings.
    /** Day of month rent is due. Capped at 28 so every month has that day. */
    dueDay: smallint("due_day").notNull().default(5),
    /** Unused since the WhatsApp Automation screen (reminder days live in `automations`). TODO(M11): drop. */
    reminderRules: jsonb("reminder_rules").notNull().default({ offsets_days: [-2, 0, 3, 7] }),
    lateFeeRule: jsonb("late_fee_rule"),
    upiVpa: text("upi_vpa"),
    payeeName: text("payee_name"),
    /** Optional mobile number linked to the owner's UPI, shown on bills next to the UPI ID. */
    upiPhone: text("upi_phone"),
    /** Owner's "Pause all": no bills, reminders or confirmations go out on WhatsApp; approved bills wait. */
    automationsPaused: boolean("automations_paused").notNull().default(false),
    electricityRatePaise: paise("electricity_rate_paise"),
    /** Null = use RentFlow's shared WhatsApp number (Phase 4 adds own numbers). */
    waPhoneNumberId: text("wa_phone_number_id"),
    ...timestamps(),
  },
  (t) => [
    unique("properties_id_org").on(t.id, t.orgId),
    index("properties_org_idx").on(t.orgId),
    check("properties_due_day_range", sql`${t.dueDay} between 1 and 28`),
    check("properties_rate_non_negative", sql`${t.electricityRatePaise} >= 0`),
    check("properties_upi_vpa_format", sql`${t.upiVpa} ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$'`),
    check("properties_upi_phone_format", sql`${t.upiPhone} ~ '^[6-9][0-9]{9}$'`),
  ],
);

export const floors = pgTable(
  "floors",
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid("property_id").notNull(),
    name: text("name").notNull(),
    /** Display order; for generated floors this is the floor number (0 = ground). */
    sort: smallint("sort").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("floors_id_org").on(t.id, t.orgId),
    unique("floors_property_sort").on(t.propertyId, t.sort),
    foreignKey({ name: "floors_property_fk", columns: [t.propertyId, t.orgId], foreignColumns: [properties.id, properties.orgId] }).onDelete("cascade"),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    orgId: orgId(),
    /** Kept alongside floor_id so room-level RLS and queries don't need a join. */
    propertyId: uuid("property_id").notNull(),
    floorId: uuid("floor_id").notNull(),
    number: text("number").notNull(),
    sharing: smallint("sharing").notNull(),
    meterId: uuid("meter_id").references(() => meters.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("rooms_id_org").on(t.id, t.orgId),
    foreignKey({ name: "rooms_floor_fk", columns: [t.floorId, t.orgId], foreignColumns: [floors.id, floors.orgId] }).onDelete("cascade"),
    unique("rooms_property_number").on(t.propertyId, t.number),
    foreignKey({
      name: "rooms_property_fk",
      columns: [t.propertyId, t.orgId],
      foreignColumns: [properties.id, properties.orgId],
    }).onDelete("cascade"),
    check("rooms_sharing_range", sql`${t.sharing} between 1 and 50`),
  ],
);

export const beds = pgTable(
  "beds",
  {
    id: id(),
    orgId: orgId(),
    roomId: uuid("room_id").notNull(),
    label: text("label").notNull(),
    defaultRentPaise: paise("default_rent_paise").notNull().default(0),
    status: bedStatus("status").notNull().default("vacant"),
    ...timestamps(),
  },
  (t) => [
    unique("beds_id_org").on(t.id, t.orgId),
    unique("beds_room_label").on(t.roomId, t.label),
    foreignKey({
      name: "beds_room_fk",
      columns: [t.roomId, t.orgId],
      foreignColumns: [rooms.id, rooms.orgId],
    }).onDelete("cascade"),
    check("beds_rent_non_negative", sql`${t.defaultRentPaise} >= 0`),
  ],
);

export const userPropertyAccess = pgTable(
  "user_property_access",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    /** Manager permission overrides, e.g. {"edit_prices": true}. Shape is defined in M2. */
    permissions: jsonb("permissions").notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique("user_property_access_user_property").on(t.userId, t.propertyId),
    // Access can only be granted to someone who is already a member of the same org.
    foreignKey({
      name: "user_property_access_member_fk",
      columns: [t.orgId, t.userId],
      foreignColumns: [orgMembers.orgId, orgMembers.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "user_property_access_property_fk",
      columns: [t.propertyId, t.orgId],
      foreignColumns: [properties.id, properties.orgId],
    }).onDelete("cascade"),
  ],
);

// ─── People ─────────────────────────────────────────────────────────────────

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** WhatsApp number in E.164; the tenant's identity. */
    phone: text("phone").notNull(),
    guardianPhones: text("guardian_phones")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Storage path of the encrypted ID document (never a public URL). */
    idDocRef: text("id_doc_ref"),
    /** Only the last 4 characters of the ID number are stored in plain text (DPDP). */
    idLast4: text("id_last4"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    language: language("language").notNull().default("en"),
    email: text("email"),
    status: tenantStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("tenants_id_org").on(t.id, t.orgId),
    unique("tenants_org_phone").on(t.orgId, t.phone),
    index("tenants_phone_idx").on(t.phone),
    check("tenants_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("tenants_id_last4_len", sql`${t.idLast4} is null or char_length(${t.idLast4}) = 4`),
  ],
);

export const tenancies = pgTable(
  "tenancies",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    bedId: uuid("bed_id").notNull(),
    rentPaise: paise("rent_paise").notNull(),
    depositPaise: paise("deposit_paise").notNull().default(0),
    checkIn: date("check_in").notNull(),
    /** First day RentFlow bills (for tenants who were here before RentFlow). Null = from check-in. */
    billingStart: date("billing_start"),
    noticeDate: date("notice_date"),
    checkOut: date("check_out"),
    status: tenancyStatus("status").notNull().default("active"),
    /** Deposit settlement at check-out: amounts, and when the tenant confirmed the refund. */
    settlement: jsonb("settlement"),
    ...timestamps(),
  },
  (t) => [
    unique("tenancies_id_org").on(t.id, t.orgId),
    // "no action" (checked at end of statement), not "restrict": a tenant or bed that has
    // tenancies can't be deleted on its own, but deleting a whole org still cascades.
    foreignKey({
      name: "tenancies_tenant_fk",
      columns: [t.tenantId, t.orgId],
      foreignColumns: [tenants.id, tenants.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "tenancies_bed_fk",
      columns: [t.bedId, t.orgId],
      foreignColumns: [beds.id, beds.orgId],
    }).onDelete("no action"),
    index("tenancies_tenant_idx").on(t.tenantId),
    // A bed holds at most one current tenancy.
    uniqueIndex("tenancies_one_open_per_bed")
      .on(t.bedId)
      .where(sql`${t.status} in ('active', 'notice')`),
    check("tenancies_money_non_negative", sql`${t.rentPaise} >= 0 and ${t.depositPaise} >= 0`),
    check("tenancies_dates_ordered", sql`${t.checkOut} is null or ${t.checkOut} >= ${t.checkIn}`),
  ],
);

// ─── Audit ──────────────────────────────────────────────────────────────────

/** Append-only. Written by database triggers, never directly by the app. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    // No FK: audit rows must survive (and not block) deletes of the org they describe.
    orgId: orgId(),
    /** auth.uid() of whoever made the change; null for system jobs. */
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.orgId, t.createdAt)],
);

// ─── Services & metering (M3) ───────────────────────────────────────────────

export const serviceType = pgEnum("service_type", ["fixed", "metered", "on_request", "plan", "complaint_category", "info"]);

/**
 * Everything a property charges for or offers. Phase 1 uses `fixed`
 * (config: {"amount_paise": 20000}) and `metered` (rate from the property).
 */
export const services = pgTable(
  "services",
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid("property_id").notNull(),
    name: text("name").notNull(),
    type: serviceType("type").notNull(),
    active: boolean("active").notNull().default(true),
    config: jsonb("config").notNull().default({}),
    menuOrder: smallint("menu_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("services_id_org").on(t.id, t.orgId),
    foreignKey({ name: "services_property_fk", columns: [t.propertyId, t.orgId], foreignColumns: [properties.id, properties.orgId] }).onDelete("cascade"),
  ],
);

export const meterScope = pgEnum("meter_scope", ["room", "floor", "building"]);

export const meters = pgTable(
  "meters",
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid("property_id").notNull(),
    scope: meterScope("scope").notNull().default("room"),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("meters_id_org").on(t.id, t.orgId),
    foreignKey({ name: "meters_property_fk", columns: [t.propertyId, t.orgId], foreignColumns: [properties.id, properties.orgId] }).onDelete("cascade"),
  ],
);

export const readingKind = pgEnum("reading_kind", ["monthly", "final"]);

/**
 * A meter reading covers usage up to the end of `reading_date`. Monthly
 * readings are taken at the end of `period`; final readings on a check-out day.
 */
export const meterReadings = pgTable(
  "meter_readings",
  {
    id: id(),
    orgId: orgId(),
    meterId: uuid("meter_id").notNull(),
    kind: readingKind("kind").notNull().default("monthly"),
    period: text("period"),
    readingDate: date("reading_date").notNull(),
    /** Whole units (kWh). */
    reading: integer("reading").notNull(),
    photoRef: text("photo_ref"),
    readBy: uuid("read_by").references(() => users.id),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "meter_readings_meter_fk", columns: [t.meterId, t.orgId], foreignColumns: [meters.id, meters.orgId] }).onDelete("cascade"),
    uniqueIndex("meter_readings_one_monthly").on(t.meterId, t.period).where(sql`${t.kind} = 'monthly'`),
    index("meter_readings_meter_date_idx").on(t.meterId, t.readingDate),
    check("meter_readings_non_negative", sql`${t.reading} >= 0`),
    check("meter_readings_period_format", sql`${t.period} is null or ${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

// ─── Billing (M3) ───────────────────────────────────────────────────────────

export const cycleKind = pgEnum("cycle_kind", ["monthly", "final"]);
export const cycleStatus = pgEnum("cycle_status", ["draft", "approved", "sent"]);

export const billingCycles = pgTable(
  "billing_cycles",
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid("property_id").notNull(),
    kind: cycleKind("kind").notNull().default("monthly"),
    period: text("period").notNull(),
    /** Only for final (check-out) cycles. */
    tenancyId: uuid("tenancy_id"),
    dueDate: date("due_date").notNull(),
    status: cycleStatus("status").notNull().default("draft"),
    /** Flags computed when the draft was (re)built: [{kind, meterId, roomLabel, message}]. */
    anomalies: jsonb("anomalies").notNull().default([]),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("billing_cycles_id_org").on(t.id, t.orgId),
    foreignKey({ name: "billing_cycles_property_fk", columns: [t.propertyId, t.orgId], foreignColumns: [properties.id, properties.orgId] }).onDelete("cascade"),
    uniqueIndex("billing_cycles_one_monthly").on(t.propertyId, t.period).where(sql`${t.kind} = 'monthly'`),
    check("billing_cycles_period_format", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

export const billStatus = pgEnum("bill_status", ["draft", "sent", "partially_paid", "paid"]);

export const bills = pgTable(
  "bills",
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid("tenancy_id").notNull(),
    cycleId: uuid("cycle_id").notNull(),
    totalPaise: paise("total_paise").notNull(),
    /** Total rounded down to the rupee + a unique 1–99 paise suffix (CLAUDE.md §7.5). */
    payablePaise: paise("payable_paise").notNull().default(0),
    status: billStatus("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("bills_id_org").on(t.id, t.orgId),
    unique("bills_tenancy_cycle").on(t.tenancyId, t.cycleId),
    foreignKey({ name: "bills_cycle_fk", columns: [t.cycleId, t.orgId], foreignColumns: [billingCycles.id, billingCycles.orgId] }).onDelete("cascade"),
    foreignKey({ name: "bills_tenancy_fk", columns: [t.tenancyId, t.orgId], foreignColumns: [tenancies.id, tenancies.orgId] }).onDelete("cascade"),
    // No two bills in a cycle share a payable amount, so a bank credit maps to exactly one bill.
    uniqueIndex("bills_unique_payable").on(t.cycleId, t.payablePaise).where(sql`${t.payablePaise} > 0`),
    check("bills_payable_non_negative", sql`${t.payablePaise} >= 0`),
  ],
);

export const billLineKind = pgEnum("bill_line_kind", ["rent", "fixed", "metered", "service", "previous_due", "adjustment", "late_fee"]);

export const billLines = pgTable(
  "bill_lines",
  {
    id: id(),
    orgId: orgId(),
    billId: uuid("bill_id").notNull(),
    kind: billLineKind("kind").notNull(),
    sourceId: uuid("source_id"),
    description: text("description").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    /** Already in the ledger (previous dues, earlier adjustments): not charged again on approval. */
    carried: boolean("carried").notNull().default(false),
    /** Edited or added by the owner while reviewing the draft. */
    manual: boolean("manual").notNull().default(false),
    sort: smallint("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "bill_lines_bill_fk", columns: [t.billId, t.orgId], foreignColumns: [bills.id, bills.orgId] }).onDelete("cascade"),
    index("bill_lines_bill_idx").on(t.billId),
  ],
);

// ─── Money (M3, M5) ─────────────────────────────────────────────────────────

export const ledgerType = pgEnum("ledger_type", ["charge", "payment", "reversal", "deposit_in", "deposit_out", "adjustment"]);

/**
 * Append-only (CLAUDE.md §7.2–7.3). Dues balance = sum(amount_paise) over
 * charge/payment/reversal/adjustment (charges positive, payments negative).
 * Deposit held = sum over deposit_in (positive) and deposit_out (negative).
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid("tenancy_id").notNull(),
    type: ledgerType("type").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "ledger_entries_tenancy_fk", columns: [t.tenancyId, t.orgId], foreignColumns: [tenancies.id, tenancies.orgId] }).onDelete("cascade"),
    index("ledger_entries_tenancy_idx").on(t.tenancyId, t.createdAt),
    check("ledger_entries_nonzero", sql`${t.amountPaise} <> 0`),
  ],
);

export const creditSource = pgEnum("credit_source", ["email", "app", "statement", "gateway", "manual"]);
export const creditStatus = pgEnum("credit_status", ["unmatched", "matched", "ignored"]);

export const bankCredits = pgTable(
  "bank_credits",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    source: creditSource("source").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    utr: text("utr"),
    payerName: text("payer_name"),
    payerVpa: text("payer_vpa"),
    creditedAt: timestamp("credited_at", { withTimezone: true }).notNull(),
    /** True if the alert's sender was verified (DKIM) as the bank; only these can auto-settle. */
    verified: boolean("verified").notNull().default(false),
    raw: jsonb("raw"),
    status: creditStatus("status").notNull().default("unmatched"),
    /** Match suggestions for the owner: [{billId, tenancyId, reason, differencePaise}]. */
    suggestions: jsonb("suggestions").notNull().default([]),
    ...timestamps(),
  },
  (t) => [
    unique("bank_credits_id_org").on(t.id, t.orgId),
    uniqueIndex("bank_credits_org_utr").on(t.orgId, t.utr).where(sql`${t.utr} is not null`),
    check("bank_credits_positive", sql`${t.amountPaise} > 0`),
  ],
);

export const inboundEmailStatus = pgEnum("inbound_email_status", ["parsed", "unparsed", "ignored"]);

/** Every forwarded email, so unknown formats can be reviewed ("unparsed" queue). */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    dkimVerified: boolean("dkim_verified").notNull().default(false),
    status: inboundEmailStatus("status").notNull(),
    creditId: uuid("credit_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("inbound_emails_org_status_idx").on(t.orgId, t.status)],
);

export const claimStatus = pgEnum("claim_status", ["claimed", "matched", "rejected"]);

/** A tenant's "I paid" screenshot. Never creates a payment or receipt by itself (§7.6). */
export const paymentClaims = pgTable(
  "payment_claims",
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid("tenancy_id").notNull(),
    screenshotRef: text("screenshot_ref").notNull(),
    /** 64-bit perceptual hash (hex) to catch the same image being reused. */
    imageHash: text("image_hash").notNull(),
    utrLast4: text("utr_last4"),
    status: claimStatus("status").notNull().default("claimed"),
    /** Set when 48 hours passed with no matching bank credit. */
    flaggedAt: timestamp("flagged_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("payment_claims_id_org").on(t.id, t.orgId),
    unique("payment_claims_org_hash").on(t.orgId, t.imageHash),
    foreignKey({ name: "payment_claims_tenancy_fk", columns: [t.tenancyId, t.orgId], foreignColumns: [tenancies.id, tenancies.orgId] }).onDelete("cascade"),
    check("payment_claims_utr_last4", sql`${t.utrLast4} is null or ${t.utrLast4} ~ '^[0-9]{4}$'`),
  ],
);

export const matchMethod = pgEnum("match_method", ["unique_amount", "utr_last4", "manual"]);

export const paymentMatches = pgTable(
  "payment_matches",
  {
    id: id(),
    orgId: orgId().references(() => orgs.id, { onDelete: "cascade" }),
    /** Null only for an owner's manual settle without a bank credit. */
    creditId: uuid("credit_id"),
    billId: uuid("bill_id").notNull(),
    claimId: uuid("claim_id"),
    method: matchMethod("method").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    /** Owner who confirmed (manual or suggested matches); null for automatic ones. */
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("payment_matches_id_org").on(t.id, t.orgId),
    uniqueIndex("payment_matches_one_per_credit").on(t.creditId).where(sql`${t.creditId} is not null`),
    foreignKey({ name: "payment_matches_credit_fk", columns: [t.creditId, t.orgId], foreignColumns: [bankCredits.id, bankCredits.orgId] }),
    foreignKey({ name: "payment_matches_bill_fk", columns: [t.billId, t.orgId], foreignColumns: [bills.id, bills.orgId] }),
    foreignKey({ name: "payment_matches_claim_fk", columns: [t.claimId, t.orgId], foreignColumns: [paymentClaims.id, paymentClaims.orgId] }),
    check("payment_matches_positive", sql`${t.amountPaise} > 0`),
  ],
);

export const cashEntries = pgTable(
  "cash_entries",
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid("tenancy_id").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    receivedOn: date("received_on").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    tenantConfirmedAt: timestamp("tenant_confirmed_at", { withTimezone: true }),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    /** When the manager handed this cash to the owner. */
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("cash_entries_id_org").on(t.id, t.orgId),
    foreignKey({ name: "cash_entries_tenancy_fk", columns: [t.tenancyId, t.orgId], foreignColumns: [tenancies.id, tenancies.orgId] }).onDelete("cascade"),
    check("cash_entries_positive", sql`${t.amountPaise} > 0`),
  ],
);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid("tenancy_id").notNull(),
    paymentMatchId: uuid("payment_match_id"),
    cashEntryId: uuid("cash_entry_id"),
    number: text("number").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    pdfRef: text("pdf_ref"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("receipts_org_number").on(t.orgId, t.number),
    uniqueIndex("receipts_one_per_match").on(t.paymentMatchId).where(sql`${t.paymentMatchId} is not null`),
    uniqueIndex("receipts_one_per_cash").on(t.cashEntryId).where(sql`${t.cashEntryId} is not null`),
    foreignKey({ name: "receipts_tenancy_fk", columns: [t.tenancyId, t.orgId], foreignColumns: [tenancies.id, tenancies.orgId] }).onDelete("cascade"),
    foreignKey({ name: "receipts_match_fk", columns: [t.paymentMatchId, t.orgId], foreignColumns: [paymentMatches.id, paymentMatches.orgId] }),
    foreignKey({ name: "receipts_cash_fk", columns: [t.cashEntryId, t.orgId], foreignColumns: [cashEntries.id, cashEntries.orgId] }),
    // §7.6: a receipt comes from exactly one confirmed payment.
    check("receipts_one_source", sql`num_nonnulls(${t.paymentMatchId}, ${t.cashEntryId}) = 1`),
  ],
);

/** Payer names and VPAs remembered after the owner confirms a suggested match. */
export const payerAliases = pgTable(
  "payer_aliases",
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid("tenancy_id").notNull(),
    payerName: text("payer_name"),
    payerVpa: text("payer_vpa"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "payer_aliases_tenancy_fk", columns: [t.tenancyId, t.orgId], foreignColumns: [tenancies.id, tenancies.orgId] }).onDelete("cascade"),
    check("payer_aliases_something", sql`num_nonnulls(${t.payerName}, ${t.payerVpa}) > 0`),
  ],
);

// ─── Bot (M4) ───────────────────────────────────────────────────────────────

/** One per WhatsApp number. org_id is null until the number is matched to a tenancy. */
export const conversations = pgTable("conversations", {
  id: id(),
  orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
  phone: text("phone").notNull().unique(),
  tenancyId: uuid("tenancy_id").references(() => tenancies.id, { onDelete: "set null" }),
  state: text("state").notNull().default("idle"),
  context: jsonb("context").notNull().default({}),
  /** End of the 24-hour customer-service window (free-form replies allowed until then). */
  windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }),
  ...timestamps(),
});

export const messageDirection = pgEnum("message_direction", ["in", "out"]);

/** Every message in and out (CLAUDE.md §9). org_id is null for unregistered senders. */
export const messageLog = pgTable(
  "message_log",
  {
    id: id(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    tenancyId: uuid("tenancy_id").references(() => tenancies.id, { onDelete: "set null" }),
    direction: messageDirection("direction").notNull(),
    templateName: text("template_name"),
    waMessageId: text("wa_message_id"),
    status: text("status").notNull().default("sent"),
    payload: jsonb("payload").notNull(),
    costPaise: paise("cost_paise").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_log_phone_idx").on(t.phone, t.createdAt), index("message_log_org_idx").on(t.orgId, t.createdAt)],
);

/** Meta-approved templates. Platform-wide, so no org_id. */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: id(),
    name: text("name").notNull(),
    language: language("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    variables: smallint("variables").notNull(),
    buttons: jsonb("buttons").notNull().default([]),
    metaStatus: text("meta_status").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [unique("message_templates_name_language").on(t.name, t.language)],
);

export const automationKey = pgEnum("automation_key", ["bill", "reminder_before", "reminder_due", "reminder_overdue", "payment_confirmation"]);

/**
 * WhatsApp automations per property (CLAUDE.md H6.8): on/off, the owner's short
 * note, and the schedule (see packages/core/src/automation.ts). A missing row
 * means "on, with defaults".
 */
export const automations = pgTable(
  "automations",
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid("property_id").notNull(),
    key: automationKey("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    customNote: text("custom_note"),
    schedule: jsonb("schedule").notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique("automations_property_key").on(t.propertyId, t.key),
    foreignKey({ name: "automations_property_fk", columns: [t.propertyId, t.orgId], foreignColumns: [properties.id, properties.orgId] }).onDelete("cascade"),
    check("automations_note_length", sql`char_length(${t.customNote}) <= 120`),
  ],
);

// TODO(phase-2): service_plans, service_subscriptions, service_requests, tickets, ticket_events.
// TODO(phase-3): expenses.
