/**
 * The app's translation files (messages/<lang>.json) against English: no stray
 * keys, the same {placeholders}, and balanced ICU braces. Missing keys are
 * allowed (they show in English, see i18n/request.ts) but are reported.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANGUAGE_CODES } from "@rentflow/core";
import { describe, expect, it } from "vitest";

type Messages = { [key: string]: string | Messages };
const load = (lang: string): Messages => JSON.parse(readFileSync(fileURLToPath(new URL(`../messages/${lang}.json`, import.meta.url)), "utf8"));

function flatten(m: Messages, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === "string") out.set(prefix + k, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}
/** {name} and {count, plural, …} argument names. */
const args = (s: string) => [...new Set([...s.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]))].sort();
const balanced = (s: string) => [...s].reduce((depth, c) => (depth < 0 ? depth : depth + (c === "{" ? 1 : c === "}" ? -1 : 0)), 0) === 0;

const en = flatten(load("en"));

describe.each(LANGUAGE_CODES.filter((l) => l !== "en"))("messages/%s.json", (lang) => {
  const messages = flatten(load(lang));

  it("has only keys that English has, with the same placeholders", () => {
    for (const [key, text] of messages) {
      expect(en.has(key), `unknown key ${key}`).toBe(true);
      expect(args(text), key).toEqual(args(en.get(key)!));
      expect(balanced(text), `unbalanced braces in ${key}`).toBe(true);
      expect(text.trim(), key).not.toBe("");
    }
  });

  it("translates every line", () => {
    const missing = [...en.keys()].filter((k) => !messages.has(k));
    expect(missing).toEqual([]);
  });
});
