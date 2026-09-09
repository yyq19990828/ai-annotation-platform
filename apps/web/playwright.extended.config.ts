import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Keep the same project names, files and titles so existing screenshot paths hold.
export default defineConfig(base, {
  grep: /@visual|@stress/,
  grepInvert: [],
  // A deterministic visual difference or failed stress sequence should report once.
  retries: 0,
});
