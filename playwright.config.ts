import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      MOCK_AUTH: "1",
      LOCAL_DB_DIR: ".local-db-e2e",
      NODE_ENV: "development",
    },
  },
});
