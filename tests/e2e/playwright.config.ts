import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  webServer: process.env.CI
    ? {
        command: "npm run dev",
        port: 5000,
        timeout: 60_000,
        reuseExistingServer: false,
        env: {
          SESSION_SECRET: "e2e-test-secret",
          ASSEMBLYAI_API_KEY: "test-key",
          AUTH_USERS: "admin:admin123:admin:Test Admin:default,viewer:viewer123:viewer:Test Viewer:default",
        },
      }
    : undefined,

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
