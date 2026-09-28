import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3201";

export default defineConfig({
  testDir: "./tests",
  testMatch: "web-responsive.spec.ts",
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
      name: "small-phone",
      use: {
        ...devices["iPhone SE"],
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "modern-android",
      use: {
        ...devices["Pixel 7"],
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "phone-landscape",
      use: {
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad Mini"],
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "laptop",
      use: {
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        defaultBrowserType: "chromium",
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
