import { PGlite } from "@electric-sql/pglite";

/**
 * PGlite dengan parser tipe yang sama seperti PostgREST untuk kolom yang
 * dipakai aplikasi: DATE dikembalikan sebagai string "YYYY-MM-DD" (bukan Date),
 * numeric sebagai string (dihitung dengan Decimal), jsonb sebagai objek.
 */
export interface PgliteOptions {
  dataDir?: string;
}

export function createPglite(options: PgliteOptions = {}): PGlite {
  return new PGlite(options.dataDir ? { dataDir: options.dataDir, parsers: PARSERS } : { parsers: PARSERS });
}

const PARSERS = {
  1082: (value: string) => value, // date
} as unknown as Record<number, (value: string) => unknown>;
