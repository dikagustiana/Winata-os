import fs from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createPglite, rebuildAll, refreshProjection } from "@winata/db";
import { migrationFiles, readMigration, readSeed, seedFiles } from "./repo";

/**
 * Database lokal (MOCK_AUTH=1) memakai PGlite persisten di LOCAL_DB_DIR.
 * Skema hanya dari supabase/migrations; seed dijalankan saat app_user kosong.
 * Bila daftar migrasi berubah (dev), DB lokal dibangun ulang dari nol agar
 * perilaku sama dengan CI yang selalu membuat PGlite baru.
 */

type Cache = {
  ready?: Promise<PGlite>;
};

const globalCache = globalThis as unknown as { __winataLocalDb?: Cache };

async function listApplied(db: PGlite): Promise<string[]> {
  const exists = await db.query<{ reg: string | null }>(
    `select to_regclass('public.schema_migrations')::text as reg`,
  );
  if (!exists.rows[0]?.reg) return [];
  const rows = await db.query<{ filename: string }>(`select filename from schema_migrations order by filename`);
  return rows.rows.map((r) => r.filename);
}

async function applyAll(db: PGlite): Promise<void> {
  await db.exec(`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )`);
  for (const file of migrationFiles()) {
    await db.exec(readMigration(file));
    await db.query(`insert into schema_migrations (filename) values ($1) on conflict do nothing`, [file]);
  }
}

async function seedIfEmpty(db: PGlite): Promise<void> {
  const count = await db.query<{ n: string }>(`select count(*)::text as n from app_user`);
  if (count.rows[0]?.n !== "0") return;
  for (const file of seedFiles()) {
    await db.exec(readSeed(file));
  }
}

async function buildPositionsIfEmpty(db: PGlite): Promise<void> {
  const count = await db.query<{ n: string }>(`select count(*)::text as n from position_daily`);
  if (count.rows[0]?.n !== "0") return;
  await rebuildAll(db);
  await refreshProjection(db);
}

async function init(): Promise<PGlite> {
  const dataDir = path.resolve(process.cwd(), process.env.LOCAL_DB_DIR ?? ".local-db");
  fs.mkdirSync(dataDir, { recursive: true });

  let db = createPglite({ dataDir });
  const applied = await listApplied(db);
  const expected = migrationFiles();
  let pending = expected.filter((f) => !applied.includes(f));

  if (pending.length > 0 && applied.length > 0) {
    // Migrasi baru ditambahkan saat pengembangan: bangun ulang DB lokal.
    await db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    db = createPglite({ dataDir });
    pending = expected;
  }

  if (pending.length > 0) {
    await applyAll(db);
  }
  await seedIfEmpty(db);
  await buildPositionsIfEmpty(db);
  return db;
}

export async function getLocalDb(): Promise<PGlite> {
  const cache = (globalCache.__winataLocalDb ??= {});
  if (!cache.ready) {
    cache.ready = init().catch((error) => {
      cache.ready = undefined;
      throw error;
    });
  }
  return cache.ready;
}

export function localDataDir(): string {
  return path.resolve(process.cwd(), process.env.LOCAL_DB_DIR ?? ".local-db");
}
