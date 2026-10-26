import fs from "node:fs";
import path from "node:path";

/** Mencari root repo (berisi supabase/migrations) dari cwd aplikasi. */
export function findRepoRoot(): string {
  const configured = process.env.WINATA_REPO_ROOT;
  if (configured && fs.existsSync(path.join(configured, "supabase", "migrations"))) {
    return configured;
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "supabase", "migrations"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Root repo (supabase/migrations) tidak ditemukan. Set WINATA_REPO_ROOT.");
}

export function migrationFiles(): string[] {
  const dir = path.join(findRepoRoot(), "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function seedFiles(): string[] {
  const dir = path.join(findRepoRoot(), "supabase", "seed");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function readMigration(file: string): string {
  return fs.readFileSync(path.join(findRepoRoot(), "supabase", "migrations", file), "utf8");
}

export function readSeed(file: string): string {
  return fs.readFileSync(path.join(findRepoRoot(), "supabase", "seed", file), "utf8");
}
