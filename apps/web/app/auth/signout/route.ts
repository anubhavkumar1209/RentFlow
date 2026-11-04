import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isDemo) {
    const { endDemoSession } = await import("@/lib/demo/server");
    await endDemoSession();
  } else {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
