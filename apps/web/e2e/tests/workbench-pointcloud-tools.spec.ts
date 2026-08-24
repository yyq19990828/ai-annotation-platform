/**
 * v0.16.x · 点云工作台工具/键盘守护(P2 第二刀)。
 *
 * 见 §1 + §5:`usePointMask` 的纠缠正源于"合并的多工具键盘 effect"(B/V/Esc/P/Delete
 * 一个监听器抢占多键)。本 spec 直接钉死这些键盘 handler 的可观测后果(GPU 无关):
 *   ② 放置:B 键切框工具 → canvas 点击 → handlePlace → POST /annotations(新 box_3d)
 *   ③ 删除:点选框 → Delete 键 → handleDeleteSelected → DELETE /annotations/:id
 * 拆 3D 整簇时若动到合并键盘 handler 的结构/次序,这两条立刻报警。
 * 由 `pointcloud` project 跑(WebGL 软渲染)。
 */
import { test, expect } from "../fixtures/seed";

test.describe("workbench pointcloud tools (键盘 handler 守护)", () => {
  test("B 键 → canvas 点击放置框 → POST /annotations", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    // 起始 1 框(seed 注入)。
    await expect(page.getByText(/·\s*1\s*框/)).toBeVisible();

    // B 键切"放置框"工具(走 ThreeDWorkbench 合并键盘 effect:B→onSetThreeDTool("box"))。
    await page.locator("body").click(); // 确保焦点不在输入框
    await page.keyboard.press("b");

    // canvas 点击放置:handlePlace 对地面 raycaster,无点也按默认尺寸落框 → POST。
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/annotations(\?|$)/.test(req.url().split("/api")[1] ?? req.url()),
      { timeout: 10_000 },
    );
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
    const post = await postPromise;
    const body = post.postDataJSON() as { geometry?: { type?: string } };
    expect(body.geometry?.type).toBe("box_3d");

    // 落库后框数 +1 → "2 框"。
    await expect(page.getByText(/·\s*2\s*框/)).toBeVisible({ timeout: 10_000 });
  });

  test("点选框 → Delete 键 → DELETE /annotations/:id", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click({ position: { x: 12, y: 16 } }); // 左侧避开图标

    // 选中后 Delete 键 → handleDeleteSelected → DELETE。
    const delPromise = page.waitForRequest(
      (req) => req.method() === "DELETE" && /\/annotations\/[0-9a-f-]+/.test(req.url()),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Delete");
    await delPromise;

    // 删除后列表里该框消失(0 个 box-list-item)。
    await expect(page.locator('[data-testid^="box-list-item-"]')).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  // ④ point-mask polygon:守护 usePointMask 的纠缠正源 —— polygon 状态(pointMaskPolygonPoints)
  //    在「合并的多工具键盘 effect」里随 Enter 完成 / Esc 清理。拆 usePointMask 时若动到这个
  //    合并 handler 的结构 / 次序,这条立刻报警。
  //    P 切 point-mask → 选「多边形」→ canvas 点 3 点 → Enter 完成 → POST point_mask_3d。
  test("P → 多边形模式 → 画 polygon → Enter → POST point_mask_3d", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    // P 键切 point-mask 工具(走合并键盘 effect:P→onSetThreeDTool("point-mask"))。
    await page.locator("body").click();
    await page.keyboard.press("p");

    // 工具栏出现选点模式下拉 → 切「多边形」(pointMaskSelectMode = "polygon")。
    const modeSelect = page.getByTestId("pointmask-mode-select");
    await expect(modeSelect).toBeVisible({ timeout: 10_000 });
    await modeSelect.selectOption("polygon");

    // canvas 上点 3 点围出大三角形(覆盖中心点云区,确保 selectPointMaskInScreenPolygon 命中点)。
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    await page.mouse.click(...at(0.25, 0.3));
    await page.mouse.click(...at(0.75, 0.3));
    await page.mouse.click(...at(0.5, 0.75));

    // Enter 完成多边形(命中合并键盘 effect 的 `e.key === "Enter" && pointMaskPolygonMode` 分支)
    // → finishPointMaskPolygon → applyPointMaskSelection → POST point_mask_3d。
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/annotations(\?|$)/.test(req.url().split("/api")[1] ?? req.url()),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Enter");
    const post = await postPromise;
    const body = post.postDataJSON() as {
      annotation_type?: string;
      geometry?: { type?: string };
    };
    expect(body.annotation_type).toBe("point_mask_3d");
    expect(body.geometry?.type).toBe("point_mask_3d");
  });

  test("point-mask 多边形双击优先完成绘制，不触发框聚焦", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await page.locator("body").click();
    await page.keyboard.press("p");
    await page.getByTestId("pointmask-mode-select").selectOption("polygon");

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas boundingBox 不可用");
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    await page.mouse.click(...at(0.25, 0.3));
    await page.mouse.click(...at(0.75, 0.3));
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/annotations(\?|$)/.test(req.url().split("/api")[1] ?? req.url()),
      { timeout: 10_000 },
    );
    await page.mouse.dblclick(...at(0.5, 0.75));
    const body = postPromise.then((request) => request.postDataJSON()) as Promise<{
      geometry?: { type?: string };
    }>;
    await expect(body).resolves.toMatchObject({ geometry: { type: "point_mask_3d" } });
  });
});
