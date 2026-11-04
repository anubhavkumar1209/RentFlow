import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { PdfRenderer } from "../ports";

/** Finds a Chrome/Chromium/Edge binary for receipts: CHROME_PATH first, then the usual install locations. */
export function findBrowser(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p): p is string => Boolean(p && existsSync(p))) ?? null;
}

/** HTML → PDF with headless Chromium (CLAUDE.md §4). Returns null when no browser is installed. */
export class PuppeteerPdf implements PdfRenderer {
  constructor(private readonly executablePath: string | null = findBrowser()) {}

  async render(html: string): Promise<Buffer | null> {
    if (!this.executablePath) return null;
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.launch({ executablePath: this.executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({ format: "A5", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

/** Deterministic UUID for a phone number (demo logins; the same number always maps to the same user). */
export function demoUserId(e164: string): string {
  const h = createHash("sha256").update(`rentflow-demo:${e164}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
