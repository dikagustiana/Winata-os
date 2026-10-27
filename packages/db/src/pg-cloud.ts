import pg from "pg";
import type { Queryable, QueryResultLike } from "./queryable";

/**
 * Worker cloud (K17): pg.Pool ke pooler Supabase (transaction mode, port 6543).
 * Satu koneksi per instance serverless; tanpa prepared statement bernama dan
 * tanpa set role/set_config lintas query. Worker berjalan sebagai `postgres`
 * (pemilik tabel), sehingga RLS dan penjaga trigger tidak membatasi.
 */

type Parser = (value: string) => unknown;

function toIso(value: string, assumeUtc: boolean): string {
  if (value === "infinity" || value === "-infinity") return value;
  let text = value.replace(" ", "T");
  if (/[+-]\d{2}$/.test(text)) text = `${text}:00`;
  else if (assumeUtc && !/(Z|[+-]\d{2}:\d{2})$/.test(text)) text = `${text}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

const PARSERS: Record<number, Parser> = {
  1082: (value) => value, // date → "YYYY-MM-DD" (sama dengan PGlite/PostgREST)
  1114: (value) => toIso(value, true), // timestamp
  1184: (value) => toIso(value, false), // timestamptz
  1700: (value) => value, // numeric → string (Decimal di engine)
  20: (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  },
};

/** Parser per OID; tipe lain memakai parser bawaan pg (json/jsonb → objek). */
export function cloudTypeParser(oid: number): Parser {
  return PARSERS[oid] ?? (pg.types.getTypeParser(oid, "text") as Parser);
}

function isSupabaseHost(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

/** Konfigurasi Pool (diekspor untuk tes tanpa koneksi). */
export function connectionConfig(url: string): pg.PoolConfig & { connectionString: string; ssl: false | { rejectUnauthorized: boolean } } {
  // sslmode di URL menimpa opsi ssl di pg; dilepas agar opsi eksplisit berlaku.
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  const connectionString = parsed.toString();
  return {
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Sertifikat pooler Supabase ditandatangani CA Supabase (bukan CA publik).
    ssl: isSupabaseHost(url) ? { rejectUnauthorized: false } : false,
    types: { getTypeParser: ((oid: number) => cloudTypeParser(oid)) as unknown as typeof pg.types.getTypeParser },
  };
}

export interface CloudDb extends Queryable {
  end(): Promise<void>;
}

export function createCloudDb(url: string): CloudDb {
  const pool = new pg.Pool(connectionConfig(url));
  pool.on("error", (error) => {
    console.error("pg pool error", error);
  });
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResultLike<T>> {
      const result = await pool.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    end: () => pool.end(),
  };
}
