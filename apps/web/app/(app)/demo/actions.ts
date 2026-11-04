"use server";

import { isISODate, sampleCreditEmail, SUPPORTED_BANKS, BANK_FIXTURES, type BankCode } from "@rentflow/core";
import { orgs } from "@rentflow/db";
import { handleIncoming, receiveInboundEmail, requireOwner, runDaily, UserError } from "@rentflow/server";
import { eq } from "drizzle-orm";
import { action, fileBytes, requiredPaise, str } from "@/lib/actions";
import { isDemo } from "@/lib/env";

function demoOnly() {
  if (!isDemo || process.env.NODE_ENV === "production") throw new UserError("Demo tools only work in demo mode.");
}

/** A message "from the tenant's phone", straight into the same handler the WhatsApp webhook uses. */
export const tenantSendsAction = action(async ({ actor, deps, form }) => {
  demoOnly();
  requireOwner(actor);
  const phone = str(form, "phone");
  const replyId = str(form, "replyId");
  const image = await fileBytes(form, "image");
  if (image) await handleIncoming(deps, phone, { kind: "image", bytes: image.bytes, contentType: image.contentType });
  else if (replyId) await handleIncoming(deps, phone, { kind: "reply", id: replyId });
  else {
    const text = str(form, "text");
    if (!text) throw new UserError("Type a message.");
    await handleIncoming(deps, phone, { kind: "text", text });
  }
  return "Sent.";
});

export const bankEmailAction = action(async ({ actor, deps, form }) => {
  demoOnly();
  requireOwner(actor);
  const bank = str(form, "bank") as BankCode;
  if (!SUPPORTED_BANKS.includes(bank)) throw new UserError("Pick a bank.");
  const date = str(form, "date");
  if (!isISODate(date)) throw new UserError("Pick a date.");
  const [org] = await deps.db.select({ token: orgs.inboundEmailToken }).from(orgs).where(eq(orgs.id, actor.orgId));
  const email = sampleCreditEmail(bank, {
    amountPaise: await requiredPaise(form, "amount", "Amount"),
    utr: str(form, "utr") || String(Date.now()).slice(-12),
    payerName: str(form, "payer") || "Demo Payer",
    payerVpa: str(form, "vpa") || "demo@okaxis",
    date,
  });
  const verified = form.get("verified") === "on";
  const from = verified ? (BANK_FIXTURES.find((f) => f.bank === bank)?.email.from ?? "") : "owner@gmail.com";
  const result = await receiveInboundEmail(deps, { to: `${org?.token}@${deps.config.inboundDomain}`, from, subject: email.subject, text: email.text, dkimVerified: verified });
  if (result.status !== "parsed") return `Email received but not parsed (${result.status}).`;
  const label: Record<string, string> = {
    auto: "Matched automatically — receipt sent to the tenant.",
    suggest: "Not certain — it's waiting on the Payments page for you to confirm.",
    none: "No matching bill — it's under Unmatched payments.",
    reject: "Rejected: that UTR was already used.",
    duplicate: "Duplicate: this UTR was already recorded, so it was ignored.",
  };
  return label[result.decision] ?? result.decision;
});

export const dailyAction = action(async ({ actor, deps, form }) => {
  demoOnly();
  requireOwner(actor);
  const date = str(form, "date");
  if (!isISODate(date)) throw new UserError("Pick a date.");
  const r = await runDaily(deps, date);
  return `As of ${date}: ${r.draftsCreated} draft cycle(s) created${r.autoSent ? ` (${r.autoSent} sent automatically)` : ""}, ${r.remindersSent} reminder(s) sent, ${r.claimsFlagged} screenshot(s) flagged.`;
});
