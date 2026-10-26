import { NextResponse, type NextRequest } from "next/server";

/**
 * Penjaga sesi ringan (tanpa I/O DB, aman di edge):
 * - MOCK_AUTH=1: cookie mock_user.
 * - Cloud: cookie sesi Supabase (sb-<ref>-auth-token).
 * Otorisasi per peran tetap di server (requireRole) dan RLS.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/login" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const mock = process.env.MOCK_AUTH === "1";
  const hasMock = request.cookies.has("mock_user");
  const hasSupabase = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.endsWith("-auth-token"));

  const authenticated = mock ? hasMock : hasSupabase;
  if (!authenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
