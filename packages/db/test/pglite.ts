import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createPglite } from "../src/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
export const SEED_DIR = path.join(ROOT, "supabase", "seed");
export const FIXTURES_DIR = path.join(ROOT, "fixtures");

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function seedFiles(): string[] {
  if (!fs.existsSync(SEED_DIR)) return [];
  return fs
    .readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export interface TestDb {
  db: PGlite;
  close: () => Promise<void>;
}

/**
 * Database PGlite baru: jalankan SEMUA migrasi dari nol, lalu seed.
 * Ini adalah gerbang T-01: migrasi harus idempoten dan berurutan.
 */
export async function createTestDb(options: { seed?: boolean; migrations?: boolean } = {}): Promise<TestDb> {
  const db = createPglite();
  if (options.migrations !== false) {
    for (const file of migrationFiles()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await db.exec(sql);
      } catch (error) {
        console.error(`Migrasi gagal: ${file}`);
        throw error;
      }
    }
  }
  if (options.seed !== false) {
    for (const file of seedFiles()) {
      const sql = fs.readFileSync(path.join(SEED_DIR, file), "utf8");
      try {
        await db.exec(sql);
      } catch (error) {
        console.error(`Seed gagal: ${file}`);
        throw error;
      }
    }
  }
  return { db, close: () => db.close() };
}

/**
 * Menjalankan query sebagai pengguna aplikasi, seperti Supabase PostgREST:
 * set role authenticated + request.jwt.claims, lalu reset.
 */
export async function asRole(db: PGlite, userId: string, role: string = "authenticated"): Promise<void> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" });
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', ${quote(claims)}, false);
    set role ${role};
  `);
}

export async function asService(db: PGlite): Promise<void> {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
}

export function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function queryRows<T = Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Diharapkan galat, tetapi berhasil");
}
