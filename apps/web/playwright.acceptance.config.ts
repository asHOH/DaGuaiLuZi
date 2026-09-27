import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  // Full Match/history/Challenge journeys take over two minutes on this host.
  // Per-assertion limits stay unchanged.
  timeout: 300_000,
  projects: [
    { name: "desktop-chrome", use: { channel: "chrome" } },
    { name: "desktop-edge", use: { channel: "msedge" } },
    {
      name: "android-chrome-emulated",
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
    {
      name: "iphone-webkit-emulated",
      // Windows WebKit reached the final Replay checks at the five-minute limit.
      timeout: 600_000,
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
