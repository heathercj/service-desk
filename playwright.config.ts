import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  // Playwright's 30s default assumes a prebuilt app. This suite runs against
  // `next dev` (see the webServer note below), which compiles each route on
  // first hit, and specs that sign in as several identities pay that cost
  // repeatedly while other workers compete for the same server. 30s made
  // access-control fail roughly one run in two with a bare timeout and no
  // failing assertion. The demo walk sets its own, longer, timeout.
  timeout: 90_000,
  // Individual assertions were still on Playwright's 5s default, which is the
  // same bet the test timeout above already refused to make: against
  // `next dev`, the first assertion after a route change can be waiting on a
  // compile, and under full parallelism it waits behind other workers' compiles
  // too. That is how the golden-path spec failed on "Queued" in a full-suite
  // run and passed on its own moments later.
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.APP_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  // Playwright 1.55 has no browser build for Ubuntu 26.04, so
  // `playwright install` fails there. Set E2E_BROWSER_CHANNEL=chrome to drive
  // the system Google Chrome instead; unset, the bundled Chromium is used.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_BROWSER_CHANNEL
          ? { channel: process.env.E2E_BROWSER_CHANNEL }
          : {}),
      },
    },
  ],
  // `next start` hard-sets NODE_ENV=production, and src/lib/env.ts refuses to
  // boot with ENABLE_DEV_AUTH=true in production -- so the app can never come
  // up under it, while every spec signs in through the dev identity picker.
  // `next dev` runs as development, where dev auth is allowed. Override with
  // E2E_WEB_SERVER to point at a production-mode server instead (see
  // .github/workflows/dast.yml, which launches the standalone build with
  // NODE_ENV=test for the same reason).
  webServer: {
    command: process.env.E2E_WEB_SERVER ?? "pnpm dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
