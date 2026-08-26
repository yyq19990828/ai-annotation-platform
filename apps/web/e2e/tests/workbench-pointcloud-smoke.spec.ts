/**
 * v0.16.x · 点云工作台冒烟基线(P1)——拆 3D 整簇前的 Playwright 守护网地基。
 *
 * 缘由见 docs/plans/archive/2026-06-17-v0.16.x-pointcloud-e2e-baseline-for-3d-split.md:
 * usePsrEditor/usePointMask/usePointCloudSelection 因共享 scene+form+合并键盘 handler
 * 职责纠缠不可干净切分,jsdom 无 WebGL 单测不了 → 唯一能在拆分前后证明行为等价的是
 * Playwright 端到端。本 spec 是该网的"地基 + go/no-go 闸":验证 headless Chromium(经
 * ANGLE/SwiftShader 软渲染,见 playwright.config.ts 的 pointcloud project)能真正
 * 加载并渲染点云、无 console error。本闸不绿,后续交互断言(P2)无从谈起。
 *
 * 注:本 spec 由 `pointcloud` project 跑(带 WebGL 软渲染 launch args);默认 chromium
 * project 已 testIgnore 排除,避免无 GPU 跑挂。
 */
import { test, expect } from "../fixtures/seed";

test.describe("workbench pointcloud smoke (WebGL go/no-go)", () => {
  test("headless 加载并渲染 nuScenes 规模点云,四视图共享 renderer 且空闲停止提交", async ({
    page,
    seed,
  }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    // super_admin 可见全部项目/任务,免去 batch 可见性/分派的额外铺设。
    await seed.injectToken(page, "admin@e2e.test");

    // 收集 console error / pageerror;WebGL 跑不起来时 Three.js 会在此爆。
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const sourceUrl = msg.location().url;
      consoleErrors.push(sourceUrl ? `${msg.text()} (${sourceUrl})` : msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    // 点云加载失败时状态栏出 "点云加载失败: ..."(WebGL/解码挂的早期信号)。
    await expect(page.getByText(/点云加载失败/)).toHaveCount(0);

    // 成功信号:loadPcd 完成 → stats 出数 → 状态栏渲染 seed 返回的真实点数。这是 PointCloudScene
    // 在 headless 真跑通 WebGL 的证据(渲染失败则 stats 永不 set,此断言超时)。
    const stats = page.getByTestId("pointcloud-stats");
    await expect(stats).toBeVisible({ timeout: 20_000 });
    await expect(stats).toContainText("点");
    expect(["nuscenes_mini", "nuscenes_profile"]).toContain(lidar.lidar_fixture_source);
    expect(lidar.lidar_point_count).toBeGreaterThan(30_000);
    await expect(stats).toContainText(lidar.lidar_point_count.toLocaleString());

    // 主点云 viewport 只挂一个 Three renderer canvas；三视图 overlay 自己的 2D canvas 不计入。
    const viewport = page.getByTestId("pc-viewport");
    await expect(viewport.locator(":scope > canvas")).toHaveCount(1);
    await expect(viewport).toHaveAttribute("data-pointcloud-renderer-count", "1");

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await card.click({ position: { x: 12, y: 16 } });
    const openRefinement = page.getByRole("button", { name: "框体精修" });
    if (await openRefinement.isVisible()) await openRefinement.click();
    await expect(page.getByTestId("tri-view-renderer-panel")).toBeVisible();
    await expect(
      page.getByTestId("tri-view-renderer-panel").locator(":scope > canvas"),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        Number((await viewport.getAttribute("data-pointcloud-tri-pass-count")) ?? 0),
      )
      .toBeGreaterThan(0);

    // 先给 OrbitControls 阻尼一段稳定时间，再验证主/三视图都不再产生 renderer.render 提交。
    await page.waitForTimeout(300);
    await expect
      .poll(async () => {
        const before = Number(await viewport.getAttribute("data-pointcloud-submit-count"));
        await page.waitForTimeout(300);
        const after = Number(await viewport.getAttribute("data-pointcloud-submit-count"));
        return after - before;
      })
      .toBe(0);

    // 过滤掉与本验证无关的已知噪声(如第三方资源 404 / favicon),只对真错误失败。
    const fatal = consoleErrors.filter(
      (e) => !/favicon|net::ERR_|Download the React DevTools/i.test(e),
    );
    expect(fatal, `console errors:\n${fatal.join("\n")}`).toEqual([]);
  });
});
