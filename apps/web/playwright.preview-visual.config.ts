/** TEMPORARY P9 harness: extended (visual) selection against the built dist. */
import { defineConfig } from "@playwright/test";
import preview from "./playwright.preview.e2e.config";
export default defineConfig(preview, { grep: /@visual|@stress/, grepInvert: [], retries: 0 });
