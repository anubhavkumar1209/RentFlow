/**
 * Local adapters for demo mode and tests: files on disk, WhatsApp messages only
 * logged (the demo's phone simulator reads message_log), jobs run in-process.
 * Never used in production.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "@rentflow/db";
import { runJob } from "../jobs";
import type { AppConfig, AppDeps, AuthAdmin, FileStore, JobName, JobQueue, OutboundMessage, PdfRenderer, WhatsAppSender } from "../ports";
import { demoUserId, PuppeteerPdf } from "./common";

export { demoUserId };

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf", ".html": "text/html; charset=utf-8" };

export class LocalFileStore implements FileStore {
  constructor(private readonly root: string, private readonly urlPrefix = "/files") {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid file key");
    return full;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      return { bytes: await readFile(this.resolve(key)), contentType: TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async signedUrl(key: string): Promise<string> {
    return `${this.urlPrefix}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}

/** Records nothing itself (sendMessage logs every message); just hands back a fake message id. */
export class LoggedWhatsApp implements WhatsAppSender {
  public readonly sent: { to: string; message: OutboundMessage }[] = [];
  async send(to: string, message: OutboundMessage): Promise<{ waMessageId: string }> {
    this.sent.push({ to, message });
    return { waMessageId: `demo.${randomUUID()}` };
  }
  async downloadMedia(): Promise<{ bytes: Buffer; mimeType: string }> {
    throw new Error("In demo mode images are passed in directly.");
  }
}

/**
 * Runs jobs in-process. "background": after the current request (demo mode);
 * "sync": awaited, so tests see the result immediately.
 */
export class InlineJobs implements JobQueue {
  private deps: AppDeps | null = null;
  public readonly errors: { name: string; error: unknown }[] = [];
  constructor(private readonly mode: "background" | "sync") {}
  bind(deps: AppDeps): void {
    this.deps = deps;
  }
  async send(name: JobName, data: Record<string, unknown>): Promise<void> {
    const deps = this.deps;
    if (!deps) throw new Error("InlineJobs not bound");
    const run = () =>
      runJob(deps, name, data).catch((error: unknown) => {
        this.errors.push({ name, error });
        console.error(`[job ${name}]`, error);
      });
    if (this.mode === "sync") await run();
    else setTimeout(run, 0);
  }
}

export class DemoAuthAdmin implements AuthAdmin {
  async ensureUser(phoneE164: string): Promise<string> {
    return demoUserId(phoneE164);
  }
}

export const DEMO_CONFIG: AppConfig = {
  appUrl: "http://localhost:3000",
  receiptSecret: "demo-only-receipt-secret-not-for-production",
  inboundDomain: "in.rentflow.app",
  templateCostPaise: 0,
};

export function createDemoDeps(options: {
  db: Db;
  filesDir: string;
  jobs?: "background" | "sync";
  pdf?: PdfRenderer;
  now?: () => Date;
  config?: Partial<AppConfig>;
}): AppDeps & { jobs: InlineJobs; whatsapp: LoggedWhatsApp } {
  const jobs = new InlineJobs(options.jobs ?? "background");
  const deps = {
    db: options.db,
    whatsapp: new LoggedWhatsApp(),
    files: new LocalFileStore(options.filesDir),
    pdf: options.pdf ?? new PuppeteerPdf(),
    jobs,
    authAdmin: new DemoAuthAdmin(),
    config: { ...DEMO_CONFIG, ...options.config },
    now: options.now ?? (() => new Date()),
  };
  jobs.bind(deps);
  return deps;
}
