import { afterEach, describe, expect, it, vi } from "vitest";
import { isMockAuth, mockPasswordError } from "../lib/mock-auth";

/** T-82 (K15/R-72): mode mock tidak pernah hidup di cloud; user tanpa hash ditolak. */
describe("T-82 isMockAuth dan login mock", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("false bila VERCEL=1 walau MOCK_AUTH=1", () => {
    vi.stubEnv("MOCK_AUTH", "1");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(isMockAuth()).toBe(false);
  });

  it("false di build produksi kecuali MOCK_AUTH_ALLOW_PRODUCTION_BUILD=1", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MOCK_AUTH", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_AUTH_ALLOW_PRODUCTION_BUILD", "");
    expect(isMockAuth()).toBe(false);
    vi.stubEnv("MOCK_AUTH_ALLOW_PRODUCTION_BUILD", "1");
    expect(isMockAuth()).toBe(true);
  });

  it("true untuk dev lokal dengan MOCK_AUTH=1; false tanpa MOCK_AUTH", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MOCK_AUTH", "1");
    expect(isMockAuth()).toBe(true);
    vi.stubEnv("MOCK_AUTH", "");
    expect(isMockAuth()).toBe(false);
  });

  it("login mock: user tanpa password_hash ditolak, hash salah ditolak, hash benar lolos", () => {
    expect(mockPasswordError(null, "apa-saja")).toBe("Akun belum punya kata sandi. Minta admin mengatur kata sandi.");
    expect(mockPasswordError(undefined, "apa-saja")).toBe("Akun belum punya kata sandi. Minta admin mengatur kata sandi.");
    // sha256("winata123::winata-local")
    const hash = "1a5684430235b98fa3763f39185dc79d61081bc89797dad30deccdf35c2e6b47";
    expect(mockPasswordError(hash, "salah-sandi")).toBe("Email atau kata sandi salah.");
    expect(mockPasswordError(hash, "winata123")).toBeNull();
  });
});
