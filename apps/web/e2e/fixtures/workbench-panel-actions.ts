import { expect, type Page } from "@playwright/test";

/** Exercise the same close and drag controls as the workbench user. */
export async function panelCommand(page: Page, title: string, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name: title, exact: true });
  if (name === "隐藏面板") {
    await tab.getByRole("button", { name: `隐藏${title}`, exact: true }).click();
    return;
  }
  await tab.scrollIntoViewIfNeeded();
  const source = tab.locator("span").first();
  if (name === "浮动面板") {
    const box = await source.boundingBox();
    expect(box).not.toBeNull();
    await page.keyboard.down("Shift");
    try {
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width / 2 - 40, box!.y + 100, { steps: 10 });
      await page.mouse.up();
    } finally {
      await page.keyboard.up("Shift");
    }
    return;
  }
  const redocking = await tab.evaluate((element) => {
    const floating = element.closest(".dv-floating-overlay-host");
    return !!floating && floating.querySelectorAll("[data-tab-panel-id]").length === 1;
  });
  if (redocking) await page.keyboard.down("Shift");
  try {
    if (name.startsWith("与") && name.endsWith("合并为标签")) {
      const target = page.getByRole("tab", { name: name.slice(1, -5), exact: true });
      await source.dragTo(target);
      return;
    }
    const canvas = page.locator('[data-workbench-panel="canvas"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const positions: Record<string, { x: number; y: number }> = {
      停靠到左侧: { x: 8, y: box!.height / 2 },
      停靠到右侧: { x: box!.width - 8, y: box!.height / 2 },
      停靠到底部: { x: box!.width / 2, y: box!.height - 8 },
    };
    const targetPosition = positions[name];
    if (!targetPosition) throw new Error(`Unknown panel action: ${name}`);
    await source.dragTo(canvas, { targetPosition });
  } finally {
    if (redocking) await page.keyboard.up("Shift");
  }
}
