import { request, type FullConfig } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../fixtures/seed";
import { storeScreenshotCatalog } from "./catalog-runtime";
import { recordingPlan, screenshotCatalogPath } from "./recording-plan.mjs";

export default async function screenshotGlobalSetup(config: FullConfig): Promise<void> {
  const scope = process.env.SCREENSHOT_BACKEND_REQUIREMENTS;
  if (scope !== undefined) {
    const plan = recordingPlan(
      (process.env.SCREENSHOT_RECORDING_FLOWS ?? "").split(","),
      process.env.SCREENSHOT_RECORDING_PROFILE,
    );
    if (
      scope !== plan.backendRequirements ||
      config.projects.some((project) => !["flows", "marketing-master"].includes(project.name))
    ) {
      throw new Error(
        "Scoped backend validation is only supported for the matching recording selection.",
      );
    }
  }
  const apiBase = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
  const context = await request.newContext({ baseURL: apiBase });
  try {
    const response = await context.get(screenshotCatalogPath());
    if (!response.ok()) {
      throw new Error(
        `seed/catalog failed: ${response.status()} ${await response.text()}\n` +
          "请先运行 screenshots seed，并确保 live backend 或 protocol stub 已启动。",
      );
    }
    const catalog = (await response.json()) as ScreenshotSeedCatalog;
    if (
      scope !== undefined &&
      catalog.backend_requirements?.join(",") !== (scope === "none" ? "" : scope)
    ) {
      throw new Error(
        "Capture API did not honor the selected backend scope; refresh the API runtime.",
      );
    }
    storeScreenshotCatalog(catalog);
  } finally {
    await context.dispose();
  }
}
