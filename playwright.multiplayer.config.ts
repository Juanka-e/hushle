import { defineConfig } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

export default defineConfig({
  testDir: "./tests",
  testMatch: "web-multiplayer-guest.spec.ts",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1366, height: 768 },
  },
  projects: [
    {
      name: "chromium-multiplayer",
      use: { browserName: "chromium" },
    },
    {
      name: "webkit-multiplayer",
      use: { browserName: "webkit" },
    },
  ],
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "npm run smoke:web-server",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        gracefulShutdown: {
          signal: "SIGINT",
          timeout: 5_000,
        },
      },
});
