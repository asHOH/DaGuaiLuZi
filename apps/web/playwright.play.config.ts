import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./dev",
  testMatch: "play.spec.ts",
  workers: 1,
  timeout: 0,
  retries: 0,
  reporter: "line",
  use: { headless: false },
});
