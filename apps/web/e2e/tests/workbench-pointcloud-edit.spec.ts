/**
 * v0.16.x · 点云工作台交互断言基线(P2)—— 拆 3D 整簇前的真正守护网。
 *
 * 见 docs/plans/2026-06-17-v0.16.x-pointcloud-e2e-baseline-for-3d-split.md §1:
 * 以"交互后状态断言"(GPU 无关、确定性)钉死 usePsrEditor / usePointCloudSelection
 * 拆分前后必须保持的可观测行为,而非脆弱的画布像素。覆盖:
 *   ⑥ 点选框 → 选中高亮 + PSR 数值面板出现(选择链 + 面板渲染)
 *   ① 选中框 → 改数值字段 → 250ms 防抖后 PATCH 几何落库(usePsrEditor 核心)
 *
 * 由 `pointcloud` project 跑(WebGL 软渲染);跨帧(⑦)/ 相机面板(⑧)待 seed 补
 * scene / 相机 link 后续追加。
 */
import { test, expect } from "../fixtures/seed";

test.describe("workbench pointcloud edit (PSR 交互守护)", () => {
  test("点选 box_3d → PSR 面板出现 → 改 cx → 几何 PATCH 落库", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");

    // 点云加载(stats 出数)+ 首帧 box_3d 渲进列表。
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // ⑥ 点选 → 选中 box(PSR 浮层出现,默认折叠态)。
    // 点卡片左侧(类别标签区)而非中心 —— 中心会压到右侧 眼/锁/标签/删 图标。
    await card.click({ position: { x: 12, y: 16 } });
    // PSR 浮层默认折叠(usePsrFloatingPanel expanded=false),展开后才渲染 cx/cy/cz 输入。
    const expandBtn = page.getByLabel("展开详情");
    await expect(expandBtn).toBeVisible({ timeout: 5_000 });
    await expandBtn.click();

    const cx = page.getByLabel("cx", { exact: true });
    await expect(cx).toBeVisible({ timeout: 5_000 });
    await expect(cx).toHaveValue("1"); // seed 的 center=[1,0,1]

    // ① 改 cx → handleField → 250ms 防抖 → PATCH /annotations/:id { geometry }。
    const patchPromise = page.waitForRequest(
      (req) => req.method() === "PATCH" && /\/annotations\/[0-9a-f-]+/.test(req.url()),
      { timeout: 10_000 },
    );
    await cx.fill("3");
    const patch = await patchPromise;

    const body = patch.postDataJSON() as { geometry?: { center?: number[] } };
    expect(body.geometry?.center?.[0]).toBeCloseTo(3, 3);

    // PATCH 成功后无 fatal console error。
    const fatal = consoleErrors.filter(
      (e) => !/favicon|net::ERR_|Download the React DevTools/i.test(e),
    );
    expect(fatal, `console errors:\n${fatal.join("\n")}`).toEqual([]);
  });
});
