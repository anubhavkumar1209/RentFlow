/**
 * Sending WhatsApp messages. Every message goes through here so it is logged
 * in message_log (CLAUDE.md §9), and sent from the property's own number when
 * it has one (Phase 4), otherwise from RentFlow's shared number.
 */
import { renderTemplate } from "@rentflow/core";
import { messageLog } from "@rentflow/db";
import type { AppDeps, OutboundMessage } from "../ports";

export interface Recipient {
  phone: string;
  orgId: string | null;
  tenancyId?: string | null;
  /** properties.wa_phone_number_id, or null for the shared number. */
  phoneNumberId?: string | null;
}

/** `meta` is stored with the log row (e.g. which reminder this was), so jobs can tell what was already sent. */
export async function sendMessage(deps: AppDeps, to: Recipient, message: OutboundMessage, meta: Record<string, unknown> = {}): Promise<void> {
  let waMessageId: string | null = null;
  let status = "sent";
  let error: string | undefined;
  try {
    ({ waMessageId } = await deps.whatsapp.send(to.phone, message, to.phoneNumberId ?? null));
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }
  const payload: Record<string, unknown> = { ...message, ...meta };
  if (message.kind === "template") payload.text = renderTemplate(message.name, message.language, message.variables);
  if (error) payload.error = error;
  await deps.db.insert(messageLog).values({
    orgId: to.orgId,
    phone: to.phone,
    tenancyId: to.tenancyId ?? null,
    direction: "out",
    templateName: message.kind === "template" ? message.name : null,
    waMessageId,
    status,
    payload,
    costPaise: message.kind === "template" ? deps.config.templateCostPaise : 0,
  });
  if (error) throw new Error(`WhatsApp send failed: ${error}`);
}

export async function logInbound(
  deps: AppDeps,
  from: { phone: string; orgId: string | null; tenancyId: string | null },
  payload: Record<string, unknown>,
  waMessageId: string | null,
): Promise<void> {
  await deps.db.insert(messageLog).values({
    orgId: from.orgId,
    phone: from.phone,
    tenancyId: from.tenancyId,
    direction: "in",
    waMessageId,
    status: "received",
    payload,
  });
}
