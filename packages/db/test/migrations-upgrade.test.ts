/**
 * Upgrading an existing database, not just creating a fresh one: the migrator
 * applies every pending migration in one transaction, which is where enum changes
 * bite (a value added with ADD VALUE can't be used before it's committed).
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openLocalDb } from "../src/local";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** A copy of the migrations folder whose journal stops after `tag`. */
function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rf-mig-"));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const end = journal.entries.findIndex((e) => e.tag === tag);
  if (end < 0) throw new Error(`no migration ${tag}`);
  journal.entries = journal.entries.slice(0, end + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("upgrading an existing database", () => {
  it("adds the Indian languages to a database that already has English/Hindi data", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "rf-db-"));
    const before = await openLocalDb({ dataDir, migrationsFolder: migrationsUpTo("0008_automations") });
    await before.query("insert into users (id, phone, language) values ('00000000-0000-4000-c000-000000000001', '+919800000301', 'hi')");
    await before.close();

    const after = await openLocalDb({ dataDir, migrationsFolder: MIGRATIONS });
    const { rows: user } = await after.query<{ language: string }>("select language from users where phone = '+919800000301'");
    expect(user).toEqual([{ language: "hi" }]);
    const { rows: ta } = await after.query<{ n: number }>("select count(*)::int as n from message_templates where language = 'ta'");
    expect(ta[0]?.n).toBe(8);
    await after.query("update users set language = 'or' where phone = '+919800000301'");
    await after.close();
  }, 120_000);
});
