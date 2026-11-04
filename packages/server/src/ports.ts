/**
 * Everything the services need from the outside world. Production wires real
 * adapters (Meta Cloud API, Supabase Storage, pg-boss, Puppeteer); demo mode and
 * tests wire local ones. Services never import an adapter directly.
 */
import type { BotLanguage, Button, TemplateName, WhatsAppMenu } from "@rentflow/core";
import type { Db } from "@rentflow/db";

export type OutboundMessage =
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: Button[] }
  | { kind: "list"; menu: WhatsAppMenu }
  | { kind: "image"; fileKey: string; caption?: string }
  | { kind: "document"; fileKey: string; filename: string; caption?: string }
  | {
      kind: "template";
      name: TemplateName;
      language: BotLanguage;
      variables: string[];
      /** Payload ids for the template's quick-reply buttons, in order. */
      buttonIds?: string[];
      /** For templates with a link button: the part after PAY_PAGE_PATH (the bill's public token). */
      urlSuffix?: string;
      header?: { kind: "image" | "document"; fileKey: string; filename?: string };
    };

export interface WhatsAppSender {
  /** Sends one message to an E.164 number; returns WhatsApp's message id. */
  send(to: string, message: OutboundMessage, phoneNumberId: string | null): Promise<{ waMessageId: string }>;
  /** Downloads media a tenant sent us (a payment screenshot). */
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
}

export interface FileStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** A short-lived URL the browser can load (private storage, CLAUDE.md §13). */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface PdfRenderer {
  /** Renders a self-contained HTML document to PDF; null if no browser is available. */
  render(html: string): Promise<Buffer | null>;
}

export interface JobQueue {
  send(name: JobName, data: Record<string, unknown>): Promise<void>;
}

export interface AuthAdmin {
  /** Returns the auth user id for a phone number, creating the login if needed (used when adding managers). */
  ensureUser(phoneE164: string): Promise<string>;
}

export type JobName =
  | "bills.send"
  | "receipt.send"
  | "welcome.send"
  | "cash.confirm.send"
  | "refund.confirm.send"
  | "daily.run";

export interface AppConfig {
  /** Public URL of the web app, used in receipt verification links. */
  appUrl: string;
  /** HMAC secret for receipt verification tokens. */
  receiptSecret: string;
  /** Domain of per-org inbound addresses, e.g. "in.rentflow.app". */
  inboundDomain: string;
  /** Cost of one business-initiated (utility) template message, for message_log. */
  templateCostPaise: number;
}

export interface AppDeps {
  db: Db;
  whatsapp: WhatsAppSender;
  files: FileStore;
  pdf: PdfRenderer;
  jobs: JobQueue;
  authAdmin: AuthAdmin;
  config: AppConfig;
  /** Injectable clock, so tests and the demo can "fast-forward". */
  now: () => Date;
}
