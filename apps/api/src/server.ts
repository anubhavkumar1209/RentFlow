import { handleIncoming, receiveInboundEmail, type AppDeps, type IncomingMessage } from "@rentflow/server";
import { verifyWhatsAppSignature } from "@rentflow/server/production";
import { messageLog } from "@rentflow/db";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";

export interface ServerOptions {
  deps: AppDeps | null;
  /** Meta app secret, for X-Hub-Signature-256. */
  waAppSecret: string;
  /** The token you typed into Meta's webhook settings. */
  waVerifyToken: string;
  /** Shared secret the inbound-email provider sends in the x-inbound-secret header. */
  inboundSecret: string;
}

interface WaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { payload: string; text: string };
  image?: { id: string; mime_type?: string };
}

interface WaWebhook {
  entry?: { changes?: { value?: { messages?: WaMessage[]; statuses?: { id: string; status: string }[] } }[] }[];
}

function sameSecret(a: string, b: string | undefined): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b ?? "");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export function buildServer(options: ServerOptions = { deps: null, waAppSecret: "", waVerifyToken: "", inboundSecret: "" }): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 2 * 1024 * 1024 });

  // Keep the raw body: the WhatsApp signature is computed over the exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    try {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  const deps = () => {
    if (!options.deps) throw new Error("Server started without dependencies");
    return options.deps;
  };

  // Meta's one-time webhook verification handshake.
  app.get<{ Querystring: Record<string, string> }>("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query;
    if (q["hub.mode"] === "subscribe" && sameSecret(options.waVerifyToken, q["hub.verify_token"])) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    return reply.code(403).send();
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    if (!verifyWhatsAppSignature(options.waAppSecret, raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      return reply.code(401).send({ error: "bad signature" });
    }
    const body = req.body as WaWebhook;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          await deps().db.update(messageLog).set({ status: status.status }).where(eq(messageLog.waMessageId, status.id));
        }
        for (const m of change.value?.messages ?? []) {
          try {
            const incoming = await toIncoming(deps(), m);
            if (incoming) await handleIncoming(deps(), m.from, incoming, m.id);
          } catch (err) {
            req.log.error({ err, messageId: m.id }, "failed to handle WhatsApp message");
          }
        }
      }
    }
    // Always 200 once the signature is valid, or Meta keeps retrying.
    return { ok: true };
  });

  /**
   * Forwarded bank alerts. Point your inbound-email provider (Postmark, SendGrid,
   * Mailgun…) here and map its fields to { to, from, subject, text, dkimVerified }.
   */
  app.post<{ Body: { to?: string; from?: string; subject?: string; text?: string; dkimVerified?: boolean } }>("/inbound/email", async (req, reply) => {
    if (!sameSecret(options.inboundSecret, req.headers["x-inbound-secret"] as string | undefined)) return reply.code(401).send({ error: "unauthorised" });
    const b = req.body ?? {};
    if (!b.to || !b.from) return reply.code(400).send({ error: "to and from are required" });
    const result = await receiveInboundEmail(deps(), { to: b.to, from: b.from, subject: b.subject ?? "", text: b.text ?? "", dkimVerified: b.dkimVerified === true });
    return result.status === "unknown_address" ? reply.code(404).send(result) : result;
  });

  return app;
}

async function toIncoming(deps: AppDeps, m: WaMessage): Promise<IncomingMessage | null> {
  switch (m.type) {
    case "text":
      return { kind: "text", text: m.text?.body ?? "" };
    case "interactive": {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return r ? { kind: "reply", id: r.id, title: r.title } : null;
    }
    case "button":
      return m.button ? { kind: "reply", id: m.button.payload, title: m.button.text } : null;
    case "image": {
      if (!m.image) return null;
      const media = await deps.whatsapp.downloadMedia(m.image.id);
      return { kind: "image", bytes: media.bytes, contentType: media.mimeType };
    }
    default:
      // TODO(phase-3): voice notes and free text understanding (LLM intent).
      return { kind: "text", text: "" };
  }
}
