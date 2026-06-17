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
        req.method() === "POST" && /\/annotations(\?|$)/.test(req.url().split("/api")[1] ?? req.url()),
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
});
