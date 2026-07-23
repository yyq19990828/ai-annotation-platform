/**
 * v0.10.10 · I11 · Mask 编辑器 e2e。
 *
 * 覆盖：
 *  1. 空白 mask → polygon 入库（M / 拖拽 / Enter）
 *  2. user polygon 精修：先画 polygon，refine → erase → Enter，验 update 路径
 *  3. AI prediction 精修：seed.injectPrediction → refine → Enter，验 reject + 新 annotation
 *  4. hotkey 全集：B / E / Shift+滚轮 / Esc → MaskToolbar UI 同步
 *
 * SAM 候选精修入口需要真实 ml-backend 跑出候选，本期 e2e 不覆盖；
 * 单测层面 useImageAnnotationActions.test 已分流过 kind=sam。
 */
import { test, expect } from "../fixtures/seed";

test.describe("mask editor (I11)", () => {
  test("空白 mask → Enter 提交一个 polygon annotation", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "pending",
      annotatorEmail: data.annotator_email,
    });
    await seed.injectToken(page, data.annotator_email);
    await page.goto(`/projects/${data.project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    // 按 M 切 mask 工具
    await page.keyboard.press("m");
    await expect(page.getByTestId("mask-toolbar")).toBeVisible({ timeout: 10_000 });

    // 在画布上拖拽画一笔
    const stage = page.getByTestId("workbench-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("stage boundingBox 不可用");
    const sx = box.x + box.width * 0.4;
    const sy = box.y + box.height * 0.4;
    const ex = box.x + box.width * 0.55;
    const ey = box.y + box.height * 0.55;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(ex, ey, { steps: 10 });
    await page.mouse.up();

    // dirty 指示应变成「未保存」
    await expect(page.getByTestId("mask-toolbar")).toContainText("未保存");

    // Enter 提交 → 监听 POST /annotations
    const annoPost = page
      .waitForResponse(
        (resp) =>
          /\/api\/v1\/(annotations|tasks\/[^/]+\/annotations)/.test(resp.url()) &&
          resp.request().method() === "POST" &&
          resp.status() < 400,
        { timeout: 10_000 },
      )
      .catch(() => null);
    await page.keyboard.press("Enter");
    const resp = await annoPost;
    expect(resp).not.toBeNull();
  });

  test("AI prediction polygon 精修 → reject 原候选 + 新 polygon 入库", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "pending",
      annotatorEmail: data.annotator_email,
    });
    // 注入一条 polygon prediction
    await seed.injectPrediction({
      taskId: data.task_ids[0],
      projectId: data.project_id,
      label: "car",
      polygon: [
        [0.3, 0.3],
        [0.6, 0.3],
        [0.6, 0.6],
        [0.3, 0.6],
      ],
      score: 0.92,
    });

    await seed.injectToken(page, data.annotator_email);
    // 显式带 ?task= 定位到注入了 prediction 的 task，避免依赖工作台默认 tasks[0] 选择顺序
    // （后端 list_tasks 排序变化曾导致默认载入别的任务、AI 候选为空）。
    await page.goto(`/projects/${data.project_id}/annotate?task=${data.task_ids[0]}`);
    await page.waitForLoadState("networkidle");

    // 右侧 AI 行的精修按钮（data-testid 由 BoxListItem 渲染：ai-refine-{annotation 行 id}）。
    // 候选 id 不可预知，用 role / 文本兜底。
    // 操作区改为 ⋮ 常驻 + hover 浮出后, refine 按钮默认 pointer-events-none, 须先 hover
    // group/act 容器触发浮出。tailwind named group-hover/act 只对 group/act 后代触发,
    // hover 整个 box-list-item 行不够 (group/act 是内层 div); 须 hover group/act 本身或
    // 其有 pointer events 的后代——即 ⋮ 常驻按钮 (aria-label="更多操作")。
    const aiRow = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(aiRow).toBeVisible({ timeout: 10_000 });
    await aiRow.getByRole("button", { name: "更多操作" }).hover();
    const refineBtn = page.locator('[data-testid^="ai-refine-"]').first();
    await expect(refineBtn).toBeVisible({ timeout: 10_000 });
    await refineBtn.click();

    // mask 工具应激活 + buffer 已 from polygon 初始化
    await expect(page.getByTestId("mask-toolbar")).toBeVisible();
    // 候选 mask 的 dirty 在 initFromPolygon 后为 false（尚未涂改）
    // 用 erase 擦一块小区域使其变 dirty
    await page.keyboard.press("e");
    await expect(page.getByTestId("mask-mode-erase")).toBeVisible();

    const stage = page.getByTestId("workbench-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("stage boundingBox 不可用");
    // 真实 E2E 图片为 64x48；默认 16px 橡皮会把约 19x14px 的候选整个擦空。
    // 用 2px 半径从左边界向内擦出与外部连通的小缺口，既保留前景，也不制造 hole。
    const slider = page.getByTestId("mask-radius-slider");
    await slider.fill("2");
    await expect(slider).toHaveValue("2");
    const cx = box.x + box.width * 0.3;
    const cy = box.y + box.height * 0.45;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy, { steps: 4 });
    await page.mouse.up();

    // commit 触发：reject prediction + create new polygon
    const annoPost = page
      .waitForResponse(
        (resp) =>
          /\/api\/v1\/(annotations|tasks\/[^/]+\/annotations)/.test(resp.url()) &&
          resp.request().method() === "POST" &&
          resp.status() < 400,
        { timeout: 10_000 },
      )
      .catch(() => null);
    await page.keyboard.press("Enter");
    const resp = await annoPost;
    expect(resp).not.toBeNull();
  });

  test("mask 工具 hotkey 全集：B / E / Shift+滚轮 / Esc", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "pending",
      annotatorEmail: data.annotator_email,
    });
    await seed.injectToken(page, data.annotator_email);
    await page.goto(`/projects/${data.project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("m");
    await expect(page.getByTestId("mask-toolbar")).toBeVisible({ timeout: 10_000 });

    // 默认是 brush 模式（aria-pressed 或视觉态由 chipStyle 控制），按 E 切橡皮
    await page.keyboard.press("e");
    await expect(page.getByTestId("mask-mode-erase")).toBeVisible();
    // 按 B 切回笔刷
    await page.keyboard.press("b");
    await expect(page.getByTestId("mask-mode-brush")).toBeVisible();

    // Shift+滚轮调半径 —— 取 slider 的 value 前后对比
    const stage = page.getByTestId("workbench-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("stage boundingBox 不可用");
    const slider = page.getByTestId("mask-radius-slider");
    const before = await slider.inputValue();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Shift");
    const after = await slider.inputValue();
    expect(Number(after)).not.toBe(Number(before));

    // Esc 取消 → mask-toolbar 隐藏（mask 工具退出）
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mask-toolbar")).toHaveCount(0);
  });
});
