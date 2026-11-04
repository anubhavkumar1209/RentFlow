import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE } from "./lib/demo/constants";
import { isDemo, supabaseConfig } from "./lib/env";

const PUBLIC_PATHS = new Set(["/", "/login"]);
/** Receipt verification (/r/) and the tenant's bill & pay page (/p/) are public: tenants never log in. */
const isPublic = (pathname: string) => PUBLIC_PATHS.has(pathname) || pathname.startsWith("/r/") || pathname.startsWith("/p/");

/** Refreshes the Supabase session cookie on every request and keeps logged-out visitors on /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let signedIn: boolean;

  if (isDemo) {
    signedIn = request.cookies.has(DEMO_COOKIE);
  } else {
    const { url, key } = supabaseConfig();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims);
  }

  const { pathname } = request.nextUrl;
  if (!signedIn && !isPublic(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
