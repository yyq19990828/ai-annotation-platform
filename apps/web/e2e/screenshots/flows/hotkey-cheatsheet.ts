/**
 * 流程录制：键盘快捷键面板（按 ? 打开）。
 *
 * 输出：outputs/flows/hotkey-cheatsheet.gif → docs-site/.../workbench/hotkey-cheatsheet.gif
 *
 * 进 screenshot catalog 的 image_demo 图片工作台 → 按 `?` 打开「键盘快捷键」Modal（hotkeys.ts 全局 dispatch
 * showHotkeys，HotkeyCheatSheet.tsx 渲染分组 + 搜索框）→ 停留展示分组 → 在搜索框输入
 * 关键词演示过滤 → 清空 → Escape 关闭。不落任何标注，无需 afterAll 清理。
 *
 * 返回 { drawStartMs, drawEndMs }：交互段起止时间戳，供 finalize 裁掉开头(加载)与结尾。
 */
import type { Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { openImageAnnotate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

export async function runHotkeyCheatSheet(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await openImageAnnotate(page, catalog);
  await page.waitForTimeout(1400);

  const drawStartMs = Date.now();

  // 按 ? 打开快捷键面板（全局 keydown，工作台默认无聚焦输入框）
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("键盘快捷键").waitFor({ timeout: 4000 });
  await page.waitForTimeout(1800); // 停留展示分组列表（绘制 / 视图 / AI / 导航 / 系统…）

  // 搜索框（Modal 打开后 autoFocus）逐字输入演示过滤
  const search = dialog.getByPlaceholder("搜索：动作描述 / 按键…");
  await search.click();
  for (const ch of "采纳") {
    await search.type(ch);
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(1400); // 展示过滤后的命中结果

  // 清空搜索，分组列表恢复
  await search.fill("");
  await page.waitForTimeout(1400);

  // 再展示一次跨分组搜索，说明面板不只用于 AI 决策快捷键。
  for (const ch of "视频") {
    await search.type(ch);
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(1_400);
  await search.fill("");
  await page.waitForTimeout(900);

  await page.keyboard.press("Escape"); // 关闭面板
  await dialog.waitFor({ state: "hidden", timeout: 4_000 });
  await page.waitForTimeout(1_400);

  return { drawStartMs, drawEndMs: Date.now() };
}
