/**
 * Server untuk e2e: hapus database lokal e2e, lalu jalankan `next dev` dengan
 * MOCK_AUTH=1. Dipakai playwright.config.ts sebagai webServer.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "apps", "web");
const dbDir = path.join(appDir, ".local-db-e2e");

if (process.env.E2E_KEEP_DB !== "1") {
  fs.rmSync(dbDir, { recursive: true, force: true });
}

const nextBin = path.join(appDir, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", "3100"], {
  cwd: appDir,
  stdio: "inherit",
  env: {
    ...process.env,
    MOCK_AUTH: "1",
    LOCAL_DB_DIR: ".local-db-e2e",
    WINATA_REPO_ROOT: root,
    CRON_SECRET: "e2e-secret",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "development",
  },
});

let stopped = false;

function stopChild() {
  if (stopped) return;
  stopped = true;
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopChild();
    process.exit(0);
  });
}
process.on("exit", stopChild);

child.on("exit", (code) => {
  stopped = true;
  process.exit(code ?? 0);
});
