/**
 * v0.23.5 · WS-C · E2E · 锁定对象经 mask 工具不可修改 (A4)。
 *
 * 验收 §3「锁定对象经所有 UI / 快捷键路径不可修改」:
 *  - 选中一个 is_locked=true 的 annotation 后按 M 进 mask 工具;
 *  - 工具栏「笔刷 / 橡皮」按钮 disabled (canEditMask=false 的直接 UI 证据);
 *  - B / E 快捷键不切换模式 (hotkey 经 canEditMask 拦截)。
 *
 * 用 per-annotation is_locked (而非 task 只读), 因为 task 只读 (review/completed) 时
 * annotator 工作台可能不渲染 mask 工具条 (tool 切换在只读态受限), 导致测试不稳定;
 * per-annotation is_locked 让 task 保持可编辑, mask 工具条正常渲染, canEditMask 据选中
 * annotation 的 is_locked 判定。per-annotation / taskReadOnly 两条走 canEditMask 同一
 * 拒绝分支, 等价覆盖 (纯函数层 8 个锁定场景见 canEditMask.test.ts)。
 *
 * 选择策略: 用 API 建一个居中较大 bbox 并锁定; reload 后 bbox 渲染在画布上, 用 bbox
 * 几何中心点选 (避开 canvas 拖框误画: 先切 select 工具)。
 */
import { test, expect } from "../fixtures/seed";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL?.endsWith(":3000")
  ? process.env.PLAYWRIGHT_BASE_URL.replace(":3000", ":8000")
  : (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8000");

test.describe("mask lock bypass (v0.23.5 A4)", () => {
  test("锁定 annotation 经 mask 工具不可修改", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "pending",
      annotatorEmail: data.annotator_email,
    });

    // 1. API 直接建一个居中大 bbox + 锁定 (task 保持 pending, 可编辑)。
    const loginRes = await seed.request.post(`${API_BASE}/api/v1/__test/seed/login`, {
      data: { email: data.annotator_email },
    });
    const { access_token } = await loginRes.json();
    const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
    const createRes = await seed.request.post(
      `${API_BASE}/api/v1/tasks/${data.task_ids[0]}/annotations`,
      {
        headers,
        data: {
          annotation_type: "bbox",
          tool_unit_id: "bbox",
          class_name: "car",
          geometry: { type: "bbox", x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
        },
      },
    );
    expect(createRes.status()).toBe(201);
    const annotationId = (await createRes.json()).id;
    const lockResp = await seed.request.post(
      `${API_BASE}/api/v1/annotations/bulk-update`,
      { headers, data: { ids: [annotationId], patch: { is_locked: true } } },
    );
    expect(lockResp.ok()).toBeTruthy();

    // 2. 进工作台, 等 annotation 列表加载。
    await seed.injectToken(page, data.annotator_email);
    await page.goto(`/projects/${data.project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    // 3. 切 select 工具 (避免 box 工具点选时误画), 点 bbox 中心选中锁定对象。
    const selectBtn = page.getByTestId("tool-btn-select");
    if (await selectBtn.isVisible().catch(() => false)) {
      await selectBtn.click();
    }
    const stage = page.getByTestId("workbench-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("workbench-stage boundingBox 不可用");
    // bbox (0.3,0.3,0.4,0.4) 中心 (0.5,0.5)。
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;
    await page.mouse.click(cx, cy);
    // 等选中态在 React 落定 (annotationsRef.current 已含 is_locked)。
    await page.waitForTimeout(800);

    // 4. 按 M 进 mask 工具 (task 可编辑 → 工具条正常渲染)。
    await page.keyboard.press("m");
    await expect(page.getByTestId("mask-toolbar")).toBeVisible({ timeout: 10_000 });

    // 5. 工具栏笔刷 / 橡皮应 disabled (canEdit=false: 选中 annotation is_locked=true)。
    //    这是 canEditMask 在生产 UI 的直接证据 (toolbar canEdit prop 由 canEditMask 计算)。
    await expect(page.getByTestId("mask-mode-brush")).toBeDisabled({ timeout: 5_000 });
    await expect(page.getByTestId("mask-mode-erase")).toBeDisabled({ timeout: 5_000 });

    // 6. B / E 快捷键不切换模式 (锁定时 hotkey 经 canEditMask 拦截)。
    await page.keyboard.press("b");
    await expect(page.getByTestId("mask-mode-brush")).toBeDisabled();
    await page.keyboard.press("e");
    await expect(page.getByTestId("mask-mode-erase")).toBeDisabled();
  });
});
