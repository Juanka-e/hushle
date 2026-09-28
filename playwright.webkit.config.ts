import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
  },
  projects: [
    {
      name: "webkit-iphone-public",
      testMatch: "web-responsive.spec.ts",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
      },
    },
    {
      name: "webkit-desktop-public",
      testMatch: "web-responsive.spec.ts",
      use: {
        ...devices["Desktop Safari"],
        browserName: "webkit",
      },
    },
    {
      name: "webkit-iphone-auth",
      testMatch: "web-launch-auth.spec.ts",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
      },
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
