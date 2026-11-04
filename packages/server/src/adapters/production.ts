/**
 * Production adapters: Meta WhatsApp Cloud API (official only, CLAUDE.md §9),
 * Supabase Storage (private bucket, signed URLs), Supabase Auth admin, pg-boss.
 * Configured entirely from environment variables (see apps/api/.env.example).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { connectPostgres, type Db } from "@rentflow/db";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import type { AppConfig, AppDeps, AuthAdmin, FileStore, JobName, JobQueue, OutboundMessage, WhatsAppSender } from "../ports";
import { LANGUAGES, TEMPLATES } from "@rentflow/core";
import { PuppeteerPdf } from "./common";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

// ─── WhatsApp Cloud API ─────────────────────────────────────────────────────

export class CloudApiWhatsApp implements WhatsAppSender {
  private readonly base: string;
  constructor(
    private readonly token: string,
    private readonly defaultPhoneNumberId: string,
    private readonly files: FileStore,
    graphVersion = "v21.0",
  ) {
    this.base = `https://graph.facebook.com/${graphVersion}`;
  }

  private async call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}/${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(body.error ?? body)}`);
    return body;
  }

  private async upload(phoneNumberId: string, fileKey: string, filename?: string): Promise<string> {
    const file = await this.files.get(fileKey);
    if (!file) throw new Error(`File not found: ${fileKey}`);
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", file.contentType);
    form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), filename ?? fileKey.split("/").at(-1));
    const body = await this.call(`${phoneNumberId}/media`, { method: "POST", body: form });
    return String(body.id);
  }

  async send(to: string, message: OutboundMessage, phoneNumberId: string | null): Promise<{ waMessageId: string }> {
    const from = phoneNumberId ?? this.defaultPhoneNumberId;
    const payload: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, "") };
    switch (message.kind) {
      case "text":
        Object.assign(payload, { type: "text", text: { body: message.text, preview_url: false } });
        break;
      case "buttons":
        Object.assign(payload, {
          type: "interactive",
          interactive: { type: "button", body: { text: message.text }, action: { buttons: message.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
        });
        break;
      case "list":
        Object.assign(payload, {
          type: "interactive",
          interactive: {
            type: "list",
            header: { type: "text", text: message.menu.header },
            body: { text: message.menu.body },
            action: { button: message.menu.button, sections: message.menu.sections.map((s) => ({ title: s.title.slice(0, 24), rows: s.rows.map((r) => ({ id: r.id, title: r.title.slice(0, 24), description: r.description?.slice(0, 72) })) })) },
          },
        });
        break;
      case "image":
        Object.assign(payload, { type: "image", image: { id: await this.upload(from, message.fileKey), caption: message.caption } });
        break;
      case "document":
        Object.assign(payload, { type: "document", document: { id: await this.upload(from, message.fileKey, message.filename), filename: message.filename, caption: message.caption } });
        break;
      case "template": {
        const components: Record<string, unknown>[] = [];
        if (message.header) {
          const id = await this.upload(from, message.header.fileKey, message.header.filename);
          const media = message.header.kind === "image" ? { type: "image", image: { id } } : { type: "document", document: { id, filename: message.header.filename } };
          components.push({ type: "header", parameters: [media] });
        }
        components.push({ type: "body", parameters: message.variables.map((v) => ({ type: "text", text: v.replace(/\s*\n\s*/g, " ") || "-" })) });
        (message.buttonIds ?? []).slice(0, TEMPLATES[message.name].buttons.en.length).forEach((id, index) => {
          components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload: id }] });
        });
        if (TEMPLATES[message.name].url && message.urlSuffix) {
          components.push({ type: "button", sub_type: "url", index: String(TEMPLATES[message.name].buttons.en.length), parameters: [{ type: "text", text: message.urlSuffix }] });
        }
        Object.assign(payload, { type: "template", template: { name: message.name, language: { code: LANGUAGES[message.language].whatsapp }, components } });
        break;
      }
    }
    const body = await this.call(`${from}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const id = (body.messages as { id: string }[] | undefined)?.[0]?.id;
    return { waMessageId: id ?? "" };
  }

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const meta = await this.call(mediaId, { method: "GET" });
    const res = await fetch(String(meta.url), { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: String(meta.mime_type ?? "image/jpeg") };
  }
}

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyWhatsAppSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

class UnconfiguredWhatsApp implements WhatsAppSender {
  async send(): Promise<{ waMessageId: string }> {
    throw new Error("WhatsApp isn't configured in this process (set WA_ACCESS_TOKEN and WA_PHONE_NUMBER_ID).");
  }
  async downloadMedia(): Promise<{ bytes: Buffer; mimeType: string }> {
    throw new Error("WhatsApp isn't configured in this process.");
  }
}

// ─── Supabase Storage ───────────────────────────────────────────────────────

export class SupabaseStorage implements FileStore {
  constructor(private readonly url: string, private readonly serviceKey: string, private readonly bucket: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${key}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true" }),
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const res = await fetch(`${this.url}/storage/v1/object/authenticated/${this.bucket}/${key}`, { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Storage download failed: ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const res = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}/${key}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!res.ok) throw new Error(`Signing failed: ${res.status}`);
    const body = (await res.json()) as { signedURL: string };
    return `${this.url}/storage/v1${body.signedURL}`;
  }
}

// ─── Supabase Auth (adding managers) ────────────────────────────────────────

export class SupabaseAuthAdmin implements AuthAdmin {
  constructor(private readonly url: string, private readonly serviceKey: string, private readonly db: Db) {}

  async ensureUser(phoneE164: string): Promise<string> {
    const digits = phoneE164.replace(/^\+/, "");
    const lookup = async () => {
      const rows = (await this.db.execute(sql`select id from auth.users where phone = ${digits} limit 1`)) as unknown as { id: string }[] | { rows: { id: string }[] };
      return (Array.isArray(rows) ? rows : rows.rows)[0]?.id ?? null;
    };
    const existing = await lookup();
    if (existing) return existing;
    const res = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: digits, phone_confirm: true }),
    });
    const body = (await res.json()) as { id?: string; msg?: string };
    if (res.ok && body.id) return body.id;
    const again = await lookup();
    if (again) return again;
    throw new Error(`Could not create login for ${phoneE164}: ${body.msg ?? res.status}`);
  }
}

// ─── pg-boss ────────────────────────────────────────────────────────────────

export const JOB_NAMES: JobName[] = ["bills.send", "receipt.send", "welcome.send", "cash.confirm.send", "refund.confirm.send", "daily.run"];

export class PgBossJobs implements JobQueue {
  private started: Promise<PgBoss> | null = null;
  constructor(private readonly connectionString: string) {}

  boss(): Promise<PgBoss> {
    this.started ??= (async () => {
      const boss = new PgBoss(this.connectionString);
      boss.on("error", (err) => console.error("[pg-boss]", err));
      await boss.start();
      for (const name of JOB_NAMES) await boss.createQueue(name);
      return boss;
    })();
    return this.started;
  }

  async send(name: JobName, data: Record<string, unknown>): Promise<void> {
    await (await this.boss()).send(name, data, { retryLimit: 3, retryDelay: 60, retryBackoff: true });
  }
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

export function productionConfig(): AppConfig {
  return {
    appUrl: env("APP_URL"),
    receiptSecret: env("RECEIPT_SIGNING_SECRET"),
    inboundDomain: process.env.INBOUND_EMAIL_DOMAIN ?? "in.rentflow.app",
    templateCostPaise: Number(process.env.WA_TEMPLATE_COST_PAISE ?? 0),
  };
}

export function createProductionDeps(): AppDeps & { jobs: PgBossJobs } {
  const db = connectPostgres(env("DATABASE_URL"));
  const files = new SupabaseStorage(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), process.env.STORAGE_BUCKET ?? "rentflow-private");
  return {
    db,
    files,
    // The web app only queues jobs; WhatsApp credentials are needed where the workers and webhook run (apps/api).
    whatsapp: process.env.WA_ACCESS_TOKEN
      ? new CloudApiWhatsApp(env("WA_ACCESS_TOKEN"), env("WA_PHONE_NUMBER_ID"), files, process.env.WA_GRAPH_VERSION)
      : new UnconfiguredWhatsApp(),
    pdf: new PuppeteerPdf(),
    jobs: new PgBossJobs(env("DATABASE_URL")),
    authAdmin: new SupabaseAuthAdmin(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), db),
    config: productionConfig(),
    now: () => new Date(),
  };
}
