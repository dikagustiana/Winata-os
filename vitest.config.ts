import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@winata/engine": r("./packages/engine/src/index.ts"),
      "@winata/db": r("./packages/db/src/index.ts"),
      "@winata/db/local": r("./packages/db/src/local-client.ts"),
      "@winata/parsers": r("./packages/parsers/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/**/test/**/*.test.ts",
      "supabase/tests/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    reporters: ["default"],
  },
});
