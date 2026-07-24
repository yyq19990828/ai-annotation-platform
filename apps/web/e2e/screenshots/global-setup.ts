import { request, type FullConfig } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../fixtures/seed";
import { storeScreenshotCatalog } from "./catalog-runtime";

export default async function screenshotGlobalSetup(_config: FullConfig): Promise<void> {
  const apiBase = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
  const context = await request.newContext({ baseURL: apiBase });
  try {
    const response = await context.get("/api/v1/__test/seed/catalog?profile=screenshots");
    if (!response.ok()) {
      throw new Error(
        `seed/catalog failed: ${response.status()} ${await response.text()}\n` +
          "请先运行 screenshots seed，并确保 live backend 或 protocol stub 已启动。",
      );
    }
    storeScreenshotCatalog((await response.json()) as ScreenshotSeedCatalog);
  } finally {
    await context.dispose();
  }
}
