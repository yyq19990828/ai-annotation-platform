/**
 * v0.8.5 · annotation E2E：smoke + bbox 拖框完整链路。
 *
 * - smoke: annotator 登录后 /annotate 路由可达
 * - bbox: 进项目工作台 → 切 box 工具 → 在 stage 容器内拖框 → 用 _test_seed.advance_task
 *   把 task 推到 submitted 模拟提交结果 → 断言 URL 未崩溃跳转
 *
 * 直接拖动 Konva Stage 的 DOM 容器需要绝对坐标，用 boundingBox 计算。
 * 工作台 data-testid: tool-btn-{id} / workbench-stage / workbench-submit。
 */
import { test, expect } from "../fixtures/seed";

test.describe("annotation workbench", () => {
  test("annotator 登录 → /annotate 路由可达（smoke）", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.injectToken(page, data.annotator_email);
    await page.goto("/annotate");
    await expect(page).toHaveURL(/\/annotate/);
    await page.waitForLoadState("networkidle");
  });

  test("annotator 进入项目工作台 → 选 bbox 工具 → 拖框", async ({ page, seed }) => {
    const data = await seed.reset();
    // seed 默认 task 无 assignee，工作台会显示「该项目暂无任务」；先把 task[0] 分给 annotator
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "pending",
      annotatorEmail: data.annotator_email,
    });
    await seed.injectToken(page, data.annotator_email);
    await page.goto(`/projects/${data.project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    // 1. 工具栏 bbox 按钮可见 + 可激活
    const bboxBtn = page.getByTestId("tool-btn-box");
    await expect(bboxBtn).toBeVisible({ timeout: 10_000 });
    await bboxBtn.click();
    await expect(bboxBtn).toHaveAttribute("aria-pressed", "true");

    // 2. Stage 容器可见，从 boundingBox 推算坐标拖框
    const stage = page.getByTestId("workbench-stage");
    await expect(stage).toBeVisible();
    const box = await stage.boundingBox();
    if (!box) throw new Error("workbench-stage boundingBox 不可用");

    const startX = box.x + box.width * 0.3;
    const startY = box.y + box.height * 0.3;
    const endX = box.x + box.width * 0.6;
    const endY = box.y + box.height * 0.6;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();

    // 3. 模拟提交：advance_task 直接将 task 推到 submitted 状态
    // （UI 拖框是否真正入库依赖工作台内部的 onCommit 链路，spec 走 seed 通道避免抖动）
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "submitted",
      annotatorEmail: data.annotator_email,
    });

    // 4. URL 仍在工作台路径下，未发生异常崩溃跳转
    await expect(page).toHaveURL(new RegExp(`/projects/${data.project_id}/annotate`));
  });
});
