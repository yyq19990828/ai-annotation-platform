import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function openLayoutSettings(page: Page) {
  await page.getByRole("button", { name: "布局", exact: true }).click();
  await page
    .getByRole("dialog", { name: "布局快捷设置", exact: true })
    .getByRole("button", { name: "更多布局设置…", exact: true })
    .click();
  return page.getByRole("dialog", { name: "工作台设置", exact: true });
}

export async function layoutCommand(page: Page, name: string) {
  if (["标准标注布局", "专注画布布局", "恢复画布布局"].includes(name)) {
    await page.getByRole("button", { name: "布局", exact: true }).click();
    const command = page
      .getByRole("dialog", { name: "布局快捷设置", exact: true })
      .getByRole("button", { name, exact: true });
    await expect(command).toBeEnabled({ timeout: 20_000 });
    await command.click();
    return;
  }
  const dialog = await openLayoutSettings(page);
  const preset = ["审核协作布局", "图片 AI 审阅布局", "视频追踪布局"].includes(name);
  const advanced = dialog.locator("details");
  if (!preset) await advanced.locator("summary").click();
  const command = (preset ? dialog : advanced).getByRole("button", {
    name: preset ? name.replace(/布局$/, "") : name,
    exact: true,
  });
  await expect(command).toBeEnabled({ timeout: 20_000 });
  await command.click();
  await dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(dialog).toBeHidden();
}
