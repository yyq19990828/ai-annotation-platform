/**
 * v0.16.x · 点云工作台交互断言基线(P2)—— 拆 3D 整簇前的真正守护网。
 *
 * 见 docs/plans/archive/2026-06-17-v0.16.x-pointcloud-e2e-baseline-for-3d-split.md §1:
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

  // 一键贴合(Q 键):applyFit 写 setForm + 立即(非防抖)PATCH 落库 —— 守护 usePsrEditor
  // 另一类 setForm 写点(一键操作,区别于数值面板的防抖路径)。Q 键 effect 本身也是
  // 3D 合并键盘 handler 的一员,重构若动 Q 分支/applyFit↔form 接线,这条立刻报警。
  // (复位旋转 handleResetRotation 结构同型:setForm + updateAnnotationWithHistory,同受守护。)
  test("选中框 → Q 一键贴合 → 即时 PATCH 落库", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click({ position: { x: 12, y: 16 } }); // 选中,焦点落卡片(非 input)

    // Q(无修饰)→ handleFitDefault → applyFit(fitSizeAndBottom)→ setForm + 即时 PATCH。
    const patchPromise = page.waitForRequest(
      (req) => req.method() === "PATCH" && /\/annotations\/[0-9a-f-]+/.test(req.url()),
      { timeout: 10_000 },
    );
    await page.keyboard.press("q");
    const patch = await patchPromise;

    // 断 geometry 落库(box_3d 几何存在;不较真具体数值 —— 取决于点云分布)。
    const body = patch.postDataJSON() as { geometry?: { type?: string; center?: number[] } };
    expect(body.geometry?.type).toBe("box_3d");
    expect(Array.isArray(body.geometry?.center)).toBe(true);
  });

  // gizmo 拖拽(W 平移模式):TransformControls 松手 → scene.setTransformHandler → setForm +
  // boxGeometryFromPsr + PATCH(ThreeDWorkbench:682)。这是 usePsrEditor 最热、最耦合的写点
  // (在 scene-init effect 里共享 sceneRef + setForm + updateMutateRef)。拆 usePsrEditor 时
  // setTransformHandler 回调若不再接 setForm/PATCH,这条立刻报警。
  // 注:gizmo→psr 的几何数学在 PointCloudScene(重构不碰、另有 geometry 单测);此处只钉
  // 「拖 gizmo 落 PATCH」的回调接线。BEV 俯视固定相机 → 框投影画布中心、轴屏对齐 → 近中心
  // 网格扫起点拖拽,命中 gizmo 即落 PATCH(抗投影抖动)。
  test("选中框 → W gizmo 拖拽 → setTransformHandler PATCH 落库", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click({ position: { x: 12, y: 16 } }); // 选中 → gizmo 挂到框

    await page.getByRole("button", { name: "俯视" }).click(); // BEV:固定相机、轴屏对齐
    await page.waitForTimeout(400);
    await page.keyboard.press("w"); // 平移模式

    const patches: Array<{ geometry?: { type?: string; center?: number[] } }> = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && /\/annotations\/[0-9a-f-]+/.test(r.url())) {
        patches.push(r.postDataJSON() as { geometry?: { type?: string; center?: number[] } });
      }
    });

    const canvas = page.locator("canvas").first();
    const cbox = await canvas.boundingBox();
    if (!cbox) throw new Error("canvas boundingBox 不可用");
    const cx = cbox.x + cbox.width * 0.5;
    const cy = cbox.y + cbox.height * 0.5;

    // 框中心附近多起点试拖(任一命中 gizmo 轴/面即落 PATCH);命中即停。
    for (const [dx, dy] of [[0, 0], [30, 0], [0, 30], [-30, 0], [0, -30], [20, 20]]) {
      await page.mouse.move(cx + dx, cy + dy);
      await page.mouse.down();
      await page.mouse.move(cx + dx + 50, cy + dy, { steps: 8 });
      await page.mouse.move(cx + dx + 70, cy + dy, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      if (patches.length > 0) break;
    }

    expect(patches.length, "拖 gizmo 应触发至少一次几何 PATCH").toBeGreaterThan(0);
    expect(patches[0].geometry?.type).toBe("box_3d");
    expect(Array.isArray(patches[0].geometry?.center)).toBe(true);
  });

  // 三视图(TriOrthoView)overlay 可交互守护:editable 时 overlay canvas 的 computed
  // pointer-events 必须为 "auto"(否则拖边/角精修完全失效)。守护 v0.17.6 module.css→Tailwind
  // 迁移引入的 `pointer-events-none` + `pointer-events-auto` 同挂、none 胜出的回归。
  test("选中框 → 三视图 overlay 可接收事件(pointer-events: auto)", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click({ position: { x: 12, y: 16 } }); // 选中 → 三视图面板出现

    // 三视图 overlay canvas(className 含 inset-0,叠在 WebGL 渲染层之上);editable 时须能收事件。
    const overlayPE = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll("canvas")).find((el) =>
        el.className.includes("inset-0"),
      );
      if (!c) return { found: false, pe: "", isTop: false };
      const r = c.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { found: true, pe: getComputedStyle(c).pointerEvents, isTop: top === c };
    });
    expect(overlayPE.found, "三视图 overlay canvas 应存在").toBe(true);
    expect(overlayPE.pe, "overlay 必须 pointer-events:auto 才能拖框精修").toBe("auto");
    expect(overlayPE.isTop, "overlay 应为命中点最上层元素(未被遮挡)").toBe(true);
  });
});
