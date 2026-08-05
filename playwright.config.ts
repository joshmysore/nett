import { defineConfig, devices } from "@playwright/test";

const e2eDb = process.env.NETT_E2E_DB || "/tmp/nett-e2e.db";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    // Always start against the seeded e2e database so stress writes stay isolated
    // and counts stay deterministic.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NETT_DB_PATH: e2eDb,
      NETT_MESSAGES_DB: "/tmp/nett-e2e-messages.db",
    },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /.*-stress\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "desktop-light",
      testIgnore: /.*-stress\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        colorScheme: "light",
      },
    },
    {
      name: "mobile",
      testIgnore: /.*-stress\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "mobile-narrow",
      testIgnore: /.*-stress\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 700 } },
    },
    {
      name: "stress-desktop",
      testMatch: /.*-stress\.spec\.ts/,
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "stress-narrow",
      testMatch: /overflow-matrix\.spec\.ts/,
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 700 } },
    },
  ],
});
