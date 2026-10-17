import { defineConfig } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

// Connection pause panel + Admin Lab browser checks. The smoke server inherits this
// process environment, so CONNECTION_PAUSE_GRACE_SECONDS=5 keeps the decision wait short.
export default defineConfig({
  testDir: "./tests",
  testMatch: "connection-pause-panel.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
  },
  projects: [{ name: "chromium-pause", use: { browserName: "chromium" } }],
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
