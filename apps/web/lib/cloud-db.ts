import type { Queryable } from "@winata/db";
import { isMockAuth } from "./mock-mode";

/**
 * K17 / ARCHITECTURE-v1.1 §2: database worker.
 * - Mode mock (lokal/e2e): PGlite yang sama dengan aplikasi.
 * - Cloud: pg.Pool ke pooler Supabase (SUPABASE_DB_URL, transaction mode),
 *   singleton di globalThis agar dipakai ulang antar invokasi hangat.
 */

export class WorkerDbMissingError extends Error {
  constructor() {
    super("Variabel lingkungan SUPABASE_DB_URL belum diisi; worker cloud tidak bisa berjalan.");
    this.name = "WorkerDbMissingError";
  }
}

const globalCache = globalThis as unknown as { __winataWorkerDb?: Queryable };

export function workerDbConfigured(): boolean {
  return isMockAuth() || Boolean(process.env.SUPABASE_DB_URL);
}

export async function getWorkerDb(): Promise<Queryable> {
  if (isMockAuth()) {
    const { getLocalDb } = await import("./local-db");
    return getLocalDb();
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new WorkerDbMissingError();
  if (!globalCache.__winataWorkerDb) {
    const { createCloudDb } = await import("@winata/db/cloud");
    globalCache.__winataWorkerDb = createCloudDb(url);
  }
  return globalCache.__winataWorkerDb;
}
