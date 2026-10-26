import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@outreach/db";
import { getSupabasePublic } from "@/lib/env";

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/no-access", "/api/health"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie and sends anonymous visitors to /login.
 * Authorization (roles, disabled users) is NOT decided here: every page and server action re-checks it
 * against the database through lib/auth.ts.
 */
export async function updateSession(request: NextRequest) {
  const cfg = getSupabasePublic();
  const { pathname } = request.nextUrl;

  if (!cfg) {
    // No database configured (zero-key mock mode): only the public pages can work.
    if (isPublicPath(pathname)) return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(cfg.url, cfg.key, {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    },
  });

  // Do not run code between createServerClient and getClaims(): it can cause random logouts.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return response;
}
