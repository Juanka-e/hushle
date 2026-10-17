import { defineConfig } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

// Guest match claim browser checks: a guest finishes a match and moves it to an account.
// The smoke server inherits this process environment (tabu_test, Redis).
export default defineConfig({
  testDir: "./tests",
  testMatch: "guest-match-claim.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
  },
  projects: [{ name: "chromium-guest-claim", use: { browserName: "chromium" } }],
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "npm run smoke:web-server",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        gracefulShutdown: { signal: "SIGINT", timeout: 5_000 },
      },
});
