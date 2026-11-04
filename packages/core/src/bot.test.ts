import { describe, expect, it } from "vitest";
import { handleBotMessage, type BotSnapshot, type BotTenancy } from "./bot";
import { buildMenu, MAX_LIST_ROWS } from "./menu";
import { renderTemplate, TEMPLATES } from "./templates";
import { reminderOffsetFor, parseReminderOffsets } from "./reminders";
import { upiNote, upiPayLink } from "./upi";

const tenancy = (id: string, pg = "Sunrise PG"): BotTenancy => ({ tenancyId: id, propertyName: pg, roomNumber: "303", bedLabel: "A", tenantName: "Anubhav", language: "en" });
const menu = buildMenu({ propertyName: "Sunrise PG", language: "en", services: [] });
const bill = { billId: "b1", period: "2026-11", dueDate: "2026-11-05", totalPaise: 286600, payablePaise: 286601, outstandingPaise: 286600, paid: false, lines: [{ description: "Rent Nov 2026", amountPaise: 200000 }] };
const snap = (over: Partial<BotSnapshot> = {}): BotSnapshot => ({ tenancies: [tenancy("t1")], selected: tenancy("t1"), bill, menu, ...over });

describe("bot", () => {
  it("tells unknown numbers to ask their manager", () => {
    const r = handleBotMessage("idle", {}, { kind: "text", text: "hi" }, { tenancies: [], selected: null, bill: null, menu: null });
    expect(r.replies).toEqual([{ kind: "text", text: "This number isn't registered. Please ask your PG manager." }]);
  });

  it("shows the menu for hi, and every reply names the PG", () => {
    const r = handleBotMessage("idle", {}, { kind: "text", text: "Hi" }, snap());
    expect(r.replies).toEqual([{ kind: "list", menu }]);
    const bill = handleBotMessage("idle", {}, { kind: "reply", id: "menu:view_bill" }, snap());
    expect(bill.replies[0]).toMatchObject({ kind: "buttons" });
    expect((bill.replies[0] as { text: string }).text).toMatch(/^\*Sunrise PG\*\n\*Your bill for Nov 2026\*/);
    expect((bill.replies[0] as { text: string }).text).toContain("₹2,866.01");
  });

  it("asks which PG when the number has two current tenancies, then remembers the request", () => {
    const two = snap({ tenancies: [tenancy("t1"), tenancy("t2", "Moonlight Hostel")], selected: null });
    const ask = handleBotMessage("idle", {}, { kind: "text", text: "pay" }, two);
    expect(ask.state).toBe("choose_tenancy");
    expect(ask.context).toEqual({ pendingAction: "pay_now" });
    expect(ask.replies[0]).toMatchObject({ kind: "buttons", buttons: [{ id: "tenancy:t1" }, { id: "tenancy:t2" }] });
    const pick = handleBotMessage(ask.state, ask.context, { kind: "reply", id: "tenancy:t2" }, two);
    expect(pick.effects).toEqual([{ type: "select_tenancy", tenancyId: "t2", then: "pay_now" }]);
  });

  it("auto-selects the only tenancy", () => {
    const r = handleBotMessage("idle", {}, { kind: "text", text: "bill" }, snap({ selected: null }));
    expect(r.effects).toEqual([{ type: "select_tenancy", tenancyId: "t1", then: "view_bill" }]);
  });

  it("pay now hands off to the payment sender, or says there's nothing to pay", () => {
    expect(handleBotMessage("idle", {}, { kind: "reply", id: "menu:pay_now" }, snap()).effects).toEqual([{ type: "send_payment" }]);
    const paid = handleBotMessage("idle", {}, { kind: "reply", id: "menu:pay_now" }, snap({ bill: { ...bill, paid: true } }));
    expect(paid.effects).toEqual([]);
    expect((paid.replies[0] as { text: string }).text).toContain("nothing to pay");
  });

  it("screenshot flow: image → saved → asks for last 4 UTR digits", () => {
    const img = handleBotMessage("awaiting_screenshot", {}, { kind: "image" }, snap());
    expect(img.effects).toEqual([{ type: "save_screenshot" }]);
    expect(img.state).toBe("awaiting_utr");
    const utr = handleBotMessage("awaiting_utr", {}, { kind: "text", text: "6306 1234 5678" }, snap());
    expect(utr.effects).toEqual([{ type: "set_utr_last4", last4: "5678" }]);
    expect(utr.state).toBe("idle");
  });

  it("answers anything it can't map with 'didn't understand' + menu + talk to manager", () => {
    const r = handleBotMessage("idle", {}, { kind: "text", text: "what is the wifi password" }, snap());
    expect(r.replies[0]).toMatchObject({ kind: "buttons", buttons: [{ id: "menu:talk_to_manager" }] });
    expect(r.replies[1]).toEqual({ kind: "list", menu });
  });

  it("routes cash and refund confirmations", () => {
    expect(handleBotMessage("idle", {}, { kind: "reply", id: "cash:abc-1:no" }, snap()).effects).toEqual([{ type: "cash_response", entryId: "abc-1", correct: false }]);
    expect(handleBotMessage("idle", {}, { kind: "reply", id: "refund:t1:yes" }, snap()).effects).toEqual([{ type: "refund_response", tenancyId: "t1", received: true }]);
  });

  it("speaks Hindi to Hindi tenants", () => {
    const hi = { ...tenancy("t1"), language: "hi" as const };
    const r = handleBotMessage("idle", {}, { kind: "reply", id: "menu:send_screenshot" }, snap({ tenancies: [hi], selected: hi }));
    expect((r.replies[0] as { text: string }).text).toContain("स्क्रीनशॉट");
  });
});

describe("buildMenu", () => {
  it("always has the five core items and respects the 10-row limit", () => {
    const services = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Service ${i}`, type: "info" as const, active: true, menuOrder: i }));
    const m = buildMenu({ propertyName: "Sunrise PG", language: "en", services });
    const rows = m.sections.flatMap((s) => s.rows);
    expect(rows.slice(0, 5).map((r) => r.id)).toEqual(["menu:view_bill", "menu:pay_now", "menu:send_screenshot", "menu:my_receipts", "menu:talk_to_manager"]);
    expect(rows.length).toBe(MAX_LIST_ROWS);
    expect(rows.at(-1)?.id).toBe("menu:more_services");
    expect(rows.every((r) => r.title.length <= 24)).toBe(true);
  });
  it("leaves fixed and metered services off the menu", () => {
    const m = buildMenu({ propertyName: "X", language: "en", services: [{ id: "w", name: "Wi-Fi", type: "fixed", active: true, menuOrder: 1 }] });
    expect(m.sections).toHaveLength(1);
  });
});

describe("templates", () => {
  it("fills variables and every bill template carries the pay-only warning", () => {
    expect(renderTemplate("rf_cash_confirm", "en", ["Sunrise PG", "Ravi", "₹2,000", "2 Nov 2026"])).toBe(
      "Sunrise PG: Manager Ravi recorded ₹2,000 cash from you on 2 Nov 2026. Is this correct?",
    );
    expect(TEMPLATES.rf_bill.body.en).toContain("Pay ONLY to this QR or UPI ID. RentFlow will never ask you to pay anyone else.");
    expect(() => renderTemplate("rf_bill", "en", ["x"])).toThrow();
  });
  it("respects WhatsApp's 3-button and 20-character limits", () => {
    for (const def of Object.values(TEMPLATES)) {
      for (const lang of ["en", "hi"] as const) {
        expect(def.buttons[lang].length).toBeLessThanOrEqual(3);
        for (const b of def.buttons[lang]) expect(b.length).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("reminders and UPI", () => {
  it("finds the reminder for today", () => {
    const offsets = parseReminderOffsets({ offsets_days: [7, -2, 0, 3] });
    expect(offsets).toEqual([-2, 0, 3, 7]);
    expect(reminderOffsetFor("2026-11-05", offsets, "2026-11-03")).toBe(-2);
    expect(reminderOffsetFor("2026-11-05", offsets, "2026-11-12")).toBe(7);
    expect(reminderOffsetFor("2026-11-05", offsets, "2026-11-04")).toBeNull();
    expect(parseReminderOffsets(null)).toEqual([-2, 0, 3, 7]);
  });
  it("builds the UPI link from §8", () => {
    const note = upiNote("303", "A", "2026-11");
    expect(note).toBe("RF-303A-NOV");
    expect(upiPayLink({ vpa: "owner@okaxis", payeeName: "Sunrise PG", amountPaise: 286601, note })).toBe(
      "upi://pay?pa=owner%40okaxis&pn=Sunrise%20PG&am=2866.01&tn=RF-303A-NOV&cu=INR",
    );
  });
});
