import { describe, expect, it } from "vitest";
import { handleBotMessage, type BotSnapshot } from "../bot";
import { LANGUAGE_CODES, LANGUAGES, messagingLanguage, toLanguage } from "../languages";
import { TEMPLATES, WHATSAPP_LANGUAGES } from "../templates";
import { PACKS } from "./index";

const placeholders = (s: string) => [...new Set(s.match(/\{\{\d+\}\}/g) ?? [])].sort();

describe.each(LANGUAGE_CODES)("language pack: %s", (lang) => {
  const p = PACKS[lang];

  it("every template keeps the English placeholders and WhatsApp's button limits", () => {
    for (const [name, def] of Object.entries(TEMPLATES)) {
      expect(placeholders(def.body[lang]), `${name} body`).toEqual(placeholders(def.body.en));
      expect(def.buttons[lang], `${name} buttons`).toHaveLength(def.buttons.en.length);
      for (const b of def.buttons[lang]) expect(b.length, `${name} button "${b}"`).toBeLessThanOrEqual(20);
      if (def.url) expect(def.url[lang].length, `${name} link button`).toBeLessThanOrEqual(25);
    }
  });

  it("bot menu rows and buttons fit WhatsApp's limits", () => {
    for (const row of Object.values(p.bot.menu)) {
      expect(row.title.length, row.title).toBeLessThanOrEqual(24);
      expect(row.description.length, row.description).toBeLessThanOrEqual(72);
    }
    for (const b of [p.bot.talkToManagerButton, p.bot.menuShortButton, p.bot.payNowButton, p.bot.viewDetailsButton, p.bot.menuButton]) {
      expect(b.length, b).toBeLessThanOrEqual(20);
    }
  });

  it("text with values keeps the values", () => {
    expect(p.bot.payInstructions("₹2,866.01")).toContain("₹2,866.01");
    expect(p.bot.managerContact("Ravi", "+91 98000 00002")).toContain("+91 98000 00002");
    expect(p.due.before("5 Dec 2026")).toContain("5 Dec 2026");
    expect(p.payPage.exact("₹46.69")).toContain("₹46.69");
    expect(p.payPage.warn("Sunrise PG")).toContain("Sunrise PG");
    expect(p.pay.pageLink("https://x/p/t")).toContain("https://x/p/t");
    for (const v of Object.values(p.notes)) expect(v.length).toBeLessThanOrEqual(120);
  });
});

describe("languages", () => {
  it("WhatsApp goes out in a language Meta supports; Odia and Assamese use Hindi", () => {
    expect(WHATSAPP_LANGUAGES).toEqual(["en", "hi", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "ur"]);
    expect(messagingLanguage("or")).toBe("hi");
    expect(messagingLanguage("as")).toBe("hi");
    expect(PACKS.or.templates).toBe(PACKS.hi.templates);
    expect(PACKS.or.payPage.paidTitle).not.toBe(PACKS.hi.payPage.paidTitle);
  });

  it("reads codes, English names and native names (CSV import, forms)", () => {
    expect(toLanguage("ta")).toBe("ta");
    expect(toLanguage("Tamil")).toBe("ta");
    expect(toLanguage("தமிழ்")).toBe("ta");
    expect(toLanguage("Hindi")).toBe("hi");
    expect(toLanguage("klingon")).toBe("en");
    expect(LANGUAGES.ur.dir).toBe("rtl");
  });

  it("the bot understands keywords in any of the languages", () => {
    const snap: BotSnapshot = {
      tenancies: [{ tenancyId: "t1", propertyName: "Sunrise PG", room: "303", bed: "A", language: "ta" }],
      selected: { tenancyId: "t1", propertyName: "Sunrise PG", room: "303", bed: "A", language: "ta" },
      bill: null,
      services: [],
    } as unknown as BotSnapshot;
    const ask = (text: string) => handleBotMessage("idle", {}, { kind: "text", text }, snap);
    expect(ask("பில்").replies[0]).toMatchObject({ kind: "text", text: expect.stringContaining(PACKS.ta.bot.noBill) });
    expect(ask("বিল").replies[0]).toMatchObject({ kind: "text", text: expect.stringContaining(PACKS.ta.bot.noBill) });
  });
});
