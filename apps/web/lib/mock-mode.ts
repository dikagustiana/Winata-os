/**
 * K15/R-72: mode mock (PGlite + cookie mock_user) tidak pernah hidup di cloud.
 * - Di Vercel (env VERCEL terisi) selalu false.
 * - Build produksi (`next start`) hanya boleh mock bila
 *   MOCK_AUTH_ALLOW_PRODUCTION_BUILD=1 (e2e lokal/CI).
 * Modul ini tanpa impor apa pun agar aman di middleware (edge) dan vitest.
 */
export function isMockAuth(): boolean {
  if (process.env.VERCEL) return false;
  if (process.env.NODE_ENV === "production" && process.env.MOCK_AUTH_ALLOW_PRODUCTION_BUILD !== "1") return false;
  return process.env.MOCK_AUTH === "1" || process.env.NODE_ENV === "test";
}

