import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createLocalClient, type DataClient, type ViewerClaims } from "@winata/db";
import { getLocalDb } from "../local-db";
import { isMockAuth } from "../mock-mode";

export { isMockAuth };

/** Teks DESIGN-v1.1 §2 untuk fitur yang butuh SUPABASE_SERVICE_ROLE_KEY. */
export const SERVICE_KEY_MISSING =
  "Fitur ini menunggu konfigurasi server (kunci layanan Supabase). Hubungi admin.";

/** Cloud: kunci layanan diisi pemilik. Mock: selalu tersedia (PGlite). */
export function hasServiceKey(): boolean {
  return isMockAuth() || Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabel lingkungan ${name} belum diisi.`);
  return value;
}

/**
 * Klien dengan hak penuh (melewati RLS) — HANYA untuk server: Auth admin
 * (buat akun/kata sandi) dan Storage. Sesi, aksi, dan worker cloud tidak
 * memakainya (K17), sehingga app tetap jalan sebelum kunci diisi pemilik.
 */
export async function getServiceClient(): Promise<DataClient> {
  if (isMockAuth()) {
    return createLocalClient(await getLocalDb(), null) as unknown as DataClient;
  }
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(SERVICE_KEY_MISSING);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DataClient;
}

/** Klien atas nama pengguna; RLS berlaku (Supabase PostgREST / PGlite lokal). */
export async function getUserClient(claims: ViewerClaims): Promise<DataClient> {
  if (isMockAuth()) {
    return createLocalClient(await getLocalDb(), claims) as unknown as DataClient;
  }
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const store = await cookies();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) {
            store.set(name, value, options);
          }
        } catch {
          // Server Component tidak boleh menulis cookie; middleware menangani refresh.
        }
      },
    },
  });
  return client as unknown as DataClient;
}

/** Klien Supabase untuk auth (login cloud). */
export async function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase belum dikonfigurasi.");
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) store.set(name, value, options);
        } catch {
          // abaikan di Server Component
        }
      },
    },
  });
}
