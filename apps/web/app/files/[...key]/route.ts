import { NextResponse } from "next/server";
import { getDeps } from "@/lib/deps";
import { isDemo } from "@/lib/env";
import { requireActor } from "@/lib/session";

/**
 * Private files (meter photos, screenshots, receipts, QR codes). Only members of
 * the org that owns the file can open it; in production this hands out a
 * short-lived signed Supabase Storage URL (CLAUDE.md §13).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const actor = await requireActor();
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  if (parts[0] !== actor.orgId || parts.some((p) => p === ".." || p === "")) return new NextResponse("Not found", { status: 404 });
  const deps = await getDeps();
  if (!isDemo) return NextResponse.redirect(await deps.files.signedUrl(key, 300));
  const file = await deps.files.get(key);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), { headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=300" } });
}
