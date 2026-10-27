import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isMockAuth } from "./lib/mock-mode";

/**
 * Penjaga sesi ringan (aman di edge):
 * - Mode mock (lokal/e2e): cookie mock_user.
 * - Cloud: sesi Supabase; token yang kedaluwarsa diperbarui di sini dan
 *   cookie baru ditulis ke respons (Server Component tidak bisa menulis cookie).
 * K15/R-72: cookie mock_user tidak berarti apa-apa di luar mode mock dan dihapus.
 * Otorisasi per peran tetap di server (requireRole) dan RLS.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const mock = isMockAuth();
  const hasMock = request.cookies.has("mock_user");
  let response = NextResponse.next({ request });
  let authenticated = false;

  if (mock) {
    authenticated = hasMock;
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const supabase = createServerClient(url, key, {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (items) => {
            for (const { name, value } of items) request.cookies.set(name, value);
            response = NextResponse.next({ request });
            for (const { name, value, options } of items) response.cookies.set(name, value, options);
          },
        },
      });
      const { data } = await supabase.auth.getUser();
      authenticated = Boolean(data.user);
    }
  }

  if (pathname === "/login") {
    if (!mock && hasMock) response.cookies.delete("mock_user");
    return response;
  }

  if (!authenticated) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    if (!mock && hasMock) redirect.cookies.delete("mock_user");
    return redirect;
  }
  if (!mock && hasMock) response.cookies.delete("mock_user");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
