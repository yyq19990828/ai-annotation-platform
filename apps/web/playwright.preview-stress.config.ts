/** TEMPORARY P9 harness: stress (layout) selection against the built dist. */
import { defineConfig } from "@playwright/test";
import preview from "./playwright.preview.e2e.config";
export default defineConfig(preview, { grep: /@stress/, grepInvert: [], retries: 1 });
