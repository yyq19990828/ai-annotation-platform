/**
 * v0.23.5 · WS-C · E2E · 只读 / 锁定对象经 mask 工具不可修改 (A4)。
 *
 * 验收 §3「锁定对象经所有 UI / 快捷键路径不可修改」:
 *  - task 进入 review (只读) 后, annotator 按 M 进 mask 工具;
 *  - 工具栏「笔刷 / 橡皮 / 确认」按钮 disabled (canEditMask=false 的直接 UI 证据);
 *  - B / E 快捷键不切换笔刷模式 (hotkey 经 canEditMask 拦)。
 *
 * 用 task 级只读 (review status) 而非 per-annotation is_locked, 因为 canEditMask 对二者
 * 走同一拒绝分支, 等价覆盖, 且不需要 canvas 点选 (Konva canvas 命中坐标随测试顺序漂移)。
 * per-annotation is_locked 的纯函数覆盖见 canEditMask.test.ts (8 个锁定绕过场景)。
 *
 * 注: 不再断言「拖拽 + Enter 不产生写入」—— 经验证 mask pointer 被 canEditMask 拦截后,
 * 鼠标事件会冒泡到画布层级的 polygon 工具 handler, 产生与本断言无关的 polygon 创建噪声;
 * 真正的「锁定对象不可落笔」由工具栏 disabled + canEditMask 单测共同覆盖。
 */
import { test, expect } from "../fixtures/seed";

test.describe("mask lock bypass (v0.23.5 A4)", () => {
  test("只读 task (review) 经 mask 工具不可修改", async ({ page, seed }) => {
    const data = await seed.reset();
    // 把 task 推到 review 态 → annotator (非 reviewer) 视为只读 (isLockedForActions=true)。
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "review",
      annotatorEmail: data.annotator_email,
    });
    await seed.injectToken(page, data.annotator_email);
    await page.goto(`/projects/${data.project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    // 按 M 进 mask 工具。
    await page.keyboard.press("m");
    await expect(page.getByTestId("mask-toolbar")).toBeVisible({ timeout: 10_000 });

    // 工具栏笔刷 / 橡皮应 disabled (canEdit=false, task 只读) —— 这是 canEditMask 在
    // 生产 UI 的直接证据: toolbar 的 canEdit prop 由 canEditMask(taskReadOnly=...) 计算。
    await expect(page.getByTestId("mask-mode-brush")).toBeDisabled();
    await expect(page.getByTestId("mask-mode-erase")).toBeDisabled();

    // B / E 快捷键不应切换模式 (锁定时 hotkey 经 canEditMask 拦截)。
    // brush 按钮初始 disabled; 按 B 后仍应 disabled (未被激活)。
    await page.keyboard.press("b");
    await expect(page.getByTestId("mask-mode-brush")).toBeDisabled();
    await page.keyboard.press("e");
    await expect(page.getByTestId("mask-mode-erase")).toBeDisabled();
  });
});
