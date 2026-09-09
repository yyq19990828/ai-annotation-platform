import { expect, type Page } from "@playwright/test";

export async function openMaskSettings(page: Page) {
  const capsule = page.getByTestId("mask-tool-capsule");
  await expect(capsule).toBeAttached();
  if ((await capsule.getAttribute("data-panel-open")) !== "true") {
    if ((await capsule.getAttribute("data-expanded")) !== "true")
      await page.getByTestId("mask-settings-trigger").click();
    await expect(capsule).toHaveAttribute("data-expanded", "true");
    // Expansion changes the clipped quick-tools width and clamps its scroll position.
    await capsule.evaluate((node) =>
      Promise.allSettled(
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      ),
    );
    await page.getByRole("button", { name: "更多 Mask 工具", exact: true }).click();
    await expect(capsule).toHaveAttribute("data-panel-open", "true");
  }
  await expect(page.getByTestId("mask-toolbar")).toBeVisible();
}

export async function closeMaskSettings(page: Page) {
  if ((await page.getByTestId("mask-tool-capsule").getAttribute("data-panel-open")) === "true") {
    await page.getByRole("button", { name: "收起 Mask 设置", exact: true }).click();
    await expect(page.getByTestId("mask-toolbar")).toBeHidden();
  }
  // Restored trigger focus owns Enter; return keyboard input to the workbench.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
