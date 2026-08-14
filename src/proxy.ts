import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifyCookie, SESSION_COOKIE_VALUE } from "@/server/auth";

// /overlay + /api/overlay: public OBS overlay (browser source has no login
// cookie). /api/art: album covers the overlay needs — public, non-sensitive.
// NOTE: /api/presence is intentionally NOT public — only the logged-in kyote
// tab may push now-playing.
const PUBLIC_PATHS = ["/login", "/api/login", "/api/health", "/overlay", "/api/overlay", "/api/art"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const verified = verifyCookie(cookie);
  if (verified !== SESSION_COOKIE_VALUE) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
