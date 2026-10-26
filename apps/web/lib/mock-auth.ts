import { createHash } from "node:crypto";

export { isMockAuth } from "./mock-mode";

export const MOCK_NO_PASSWORD = "Akun belum punya kata sandi. Minta admin mengatur kata sandi.";
export const LOGIN_FAILED = "Email atau kata sandi salah.";

export function hashLocalPassword(password: string): string {
  return createHash("sha256").update(`${password}::winata-local`).digest("hex");
}

/** Login mock: null bila cocok; user tanpa password_hash ditolak. */
export function mockPasswordError(storedHash: string | null | undefined, password: string): string | null {
  if (!storedHash) return MOCK_NO_PASSWORD;
  return storedHash === hashLocalPassword(password) ? null : LOGIN_FAILED;
}
