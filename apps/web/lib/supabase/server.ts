import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createLocalClient, type DataClient, type ViewerClaims } from "@winata/db";
import { getLocalDb } from "../local-db";

export function isMockAuth(): boolean {
  return process.env.MOCK_AUTH === "1" || process.env.NODE_ENV === "test";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabel lingkungan ${name} belum diisi.`);
  return value;
}

/**
 * Klien dengan hak penuh (melewati RLS) — HANYA untuk server: worker rebuild,
 * cron, bootstrap sesi, dan pembuatan akun oleh admin. Tidak pernah ke klien.
 */
export async function getServiceClient(): Promise<DataClient> {
  if (isMockAuth()) {
    return createLocalClient(await getLocalDb(), null) as unknown as DataClient;
  }
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
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
