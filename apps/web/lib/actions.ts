import { ForbiddenError, UserError, type Actor, type AppDeps } from "@rentflow/server";
import { revalidatePath } from "next/cache";
import { getDeps } from "./deps";
import { requireActor } from "./session";

export interface ActionState {
  error?: string;
  ok?: string;
  /** Echo of the submitted values, so forms can refill after an error. */
  values?: Record<string, string>;
}

/**
 * Wraps a server action: loads the actor and services, turns expected errors
 * (bad input, no permission) into a message for the form, and refreshes the page.
 */
export function action(
  run: (ctx: { actor: Actor; deps: AppDeps; form: FormData }) => Promise<string | void>,
  options: { revalidate?: string } = {},
) {
  return async (_prev: ActionState, form: FormData): Promise<ActionState> => {
    const values = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
    try {
      const actor = await requireActor();
      const deps = await getDeps();
      const ok = await run({ actor, deps, form });
      revalidatePath(options.revalidate ?? "/", "layout");
      return { ok: ok ?? "Saved." };
    } catch (err) {
      if (err instanceof UserError || err instanceof ForbiddenError) return { error: err.message, values };
      // Next.js uses thrown errors for redirect()/notFound(); let those through.
      if (err && typeof err === "object" && "digest" in err) throw err;
      console.error(err);
      return { error: "Something went wrong. Please try again.", values };
    }
  };
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Reads a rupee amount typed by a person ("2,866.50") as integer paise; null if blank. */
export async function paise(form: FormData, key: string, label: string): Promise<number | null> {
  const { parseRupeesToPaise } = await import("@rentflow/core");
  const raw = str(form, key);
  if (!raw) return null;
  const negative = raw.startsWith("-");
  const value = parseRupeesToPaise(negative ? raw.slice(1) : raw);
  if (value === null) throw new UserError(`${label}: enter an amount like 2,866 or 2866.50`);
  return negative ? -value : value;
}

export async function requiredPaise(form: FormData, key: string, label: string): Promise<number> {
  const v = await paise(form, key, label);
  if (v === null) throw new UserError(`Enter ${label.toLowerCase()}.`);
  return v;
}

export async function fileBytes(form: FormData, key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const f = form.get(key);
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > 8 * 1024 * 1024) throw new UserError("That file is too big (max 8 MB).");
  return { bytes: Buffer.from(await f.arrayBuffer()), contentType: f.type || "application/octet-stream" };
}
