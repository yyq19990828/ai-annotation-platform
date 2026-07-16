import type { ScreenshotSeedCatalog } from "../fixtures/seed";

const CATALOG_ENV = "SCREENSHOT_CATALOG_JSON";

export function storeScreenshotCatalog(catalog: ScreenshotSeedCatalog): void {
  process.env[CATALOG_ENV] = JSON.stringify(catalog);
}

export function loadScreenshotCatalog(): ScreenshotSeedCatalog {
  const raw = process.env[CATALOG_ENV];
  if (!raw) {
    throw new Error("screenshot catalog 未由 Playwright global setup 初始化");
  }
  const catalog = JSON.parse(raw) as ScreenshotSeedCatalog;
  if (catalog.schema_version !== 1 || !catalog.seed_revision) {
    throw new Error("screenshot catalog 快照格式无效");
  }
  return catalog;
}
