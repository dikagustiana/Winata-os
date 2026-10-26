/**
 * Menghapus database lokal PGlite (bukan data produksi).
 * Berguna bila skema/seed ingin dibangun ulang dari nol.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appDir = path.join(root, "apps", "web");
const names = new Set<string>([
  process.env.LOCAL_DB_DIR ?? ".local-db",
  ".local-db-dev",
  ".local-db-e2e",
  ".local-db",
]);

const targets = [root, appDir].flatMap((dir) => [...names].map((name) => path.join(dir, name)));
let removed = 0;
for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`dihapus: ${path.relative(root, target)}`);
  removed += 1;
}
console.log(removed === 0 ? "Tidak ada database lokal." : `${removed} direktori database lokal dihapus.`);
