/**
 * v0.16.x · 点云工作台交互断言基线(P2)—— 拆 3D 整簇前的真正守护网。
 *
 * 见 docs/plans/archive/2026-06-17-v0.16.x-pointcloud-e2e-baseline-for-3d-split.md §1:
 * 以"交互后状态断言"(GPU 无关、确定性)钉死 usePsrEditor / usePointCloudSelection
 * 拆分前后必须保持的可观测行为,而非脆弱的画布像素。覆盖:
 *   ⑥ 点选框 → 选中高亮 + PSR 数值面板出现(选择链 + 面板渲染)
 *   ① 选中框 → 改数值字段 → 250ms 防抖后 PATCH 几何落库(usePsrEditor 核心)
 *
 * 由 `pointcloud` project 跑(WebGL 软渲染);seed 已含单路标定相机，覆盖相机内中心拖动。
 * 跨帧 scene 仍由对应邻帧 spec 单独覆盖。
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures/seed";

interface BrowserPointCloudViewState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  mode: "orbit" | "bev";
}

declare global {
  interface Window {
    __pointCloudColorWorkerCount?: number;
  }
}

async function readPointCloudViewState(page: Page): Promise<BrowserPointCloudViewState> {
  const state = await page.getByTestId("pc-viewport").evaluate((element) => {
    const scene = (
      element as HTMLElement & {
        __pointCloudScene?: { getViewState: () => BrowserPointCloudViewState };
      }
    ).__pointCloudScene;
    return scene?.getViewState() ?? null;
  });
  if (!state) throw new Error("开发态点云场景视角探针不可用");
  return state;
}

async function pointCloudBoxScreenPoint(
  page: Page,
  card: Locator,
): Promise<{ x: number; y: number }> {
  const testId = await card.getAttribute("data-testid");
  const boxId = testId?.replace(/^box-list-item-/, "");
  if (!boxId) throw new Error("box list item 缺少 annotation id");
  const point = await page.getByTestId("pc-viewport").evaluate((element, id) => {
    const scene = (
      element as HTMLElement & {
        __pointCloudScene?: {
          boxGroups: Map<
            string,
            {
              position: { clone: () => { project: (camera: unknown) => { x: number; y: number } } };
            }
          >;
          camera: unknown;
        };
      }
    ).__pointCloudScene;
    const group = scene?.boxGroups.get(id);
    if (!scene || !group) return null;
    const projected = group.position.clone().project(scene.camera);
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + ((projected.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - projected.y) / 2) * bounds.height,
    };
  }, boxId);
  if (!point) throw new Error("开发态点云场景框投影探针不可用");
  return point;
}

async function focusPointCloudBox(page: Page, card: Locator): Promise<void> {
  const testId = await card.getAttribute("data-testid");
  const boxId = testId?.replace(/^box-list-item-/, "");
  if (!boxId) throw new Error("box list item 缺少 annotation id");
  const focused = await page.getByTestId("pc-viewport").evaluate((element, id) => {
    const scene = (
      element as HTMLElement & {
        __pointCloudScene?: { focusBox: (boxId: string) => boolean };
      }
    ).__pointCloudScene;
    return scene?.focusBox(id) ?? false;
  }, boxId);
  expect(focused, "开发态点云场景应能聚焦选中框").toBe(true);
}

function expectPointCloudViewStateClose(
  actual: BrowserPointCloudViewState,
  expected: BrowserPointCloudViewState,
) {
  expect(actual.mode).toBe(expected.mode);
  for (const field of ["position", "target", "up"] as const) {
    for (let index = 0; index < 3; index += 1) {
      expect(actual[field][index]).toBeCloseTo(expected[field][index], 6);
    }
  }
}

async function waitForPointCloudViewStable(page: Page): Promise<BrowserPointCloudViewState> {
  let previous = await readPointCloudViewState(page);
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(100);
        const current = await readPointCloudViewState(page);
        const delta = Math.max(
          ...current.position.map((value, index) => Math.abs(value - previous.position[index])),
          ...current.target.map((value, index) => Math.abs(value - previous.target[index])),
          ...current.up.map((value, index) => Math.abs(value - previous.up[index])),
        );
        previous = current;
        return delta;
      },
      { timeout: 10_000, intervals: [100, 200, 300] },
    )
    .toBeLessThan(1e-6);
  return readPointCloudViewState(page);
}

async function expectCenterHitTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      return hit === element || (hit !== null && element.contains(hit));
    }),
  ).toBe(true);
}

test.describe("workbench pointcloud edit (PSR 交互守护)", () => {
  test("nuScenes mini Scene 时间轴切帧、恢复轨迹选择并可稳定折叠展开", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      const WrappedWorker = function (...args: ConstructorParameters<typeof Worker>) {
        if (String(args[0]).includes("pointcloud.worker")) {
          window.__pointCloudColorWorkerCount = (window.__pointCloudColorWorkerCount ?? 0) + 1;
        }
        return new NativeWorker(...args);
      } as typeof Worker;
      WrappedWorker.prototype = NativeWorker.prototype;
      window.Worker = WrappedWorker;
      window.__pointCloudColorWorkerCount = 0;
    });
    await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const response = await fetch("/api/v1/auth/me/preferences", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workbench: { pointcloud: { colorizeWithCamera: true } },
        }),
      });
      if (!response.ok) throw new Error(`开启相机上色失败: ${response.status}`);
    });

    let pcdRequestCount = 0;
    let releaseTargetPcd: (() => void) | null = null;
    const targetPcdGate = new Promise<void>((resolve) => {
      releaseTargetPcd = resolve;
    });
    await page.route("**/*.pcd*", async (route) => {
      pcdRequestCount += 1;
      if (pcdRequestCount > 1) await targetPcdGate;
      await route.continue();
    });

    const timelineRequests: string[] = [];
    const annotationReads: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/scene-timeline")) timelineRequests.push(request.url());
      if (request.method() === "GET" && /\/tasks\/[0-9a-f-]+\/annotations$/.test(url.pathname)) {
        annotationReads.push(request.url());
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate?task=${lidar.lidar_task_ids[0]}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => window.__pointCloudColorWorkerCount ?? 0))
      .toBeGreaterThan(0);
    await expect(page.getByText("相机上色…")).toBeHidden();
    await page.evaluate(() => {
      window.__pointCloudColorWorkerCount = 0;
    });

    const timeline = page.getByTestId("three-d-scene-timeline");
    await expect(timeline).toBeVisible({ timeout: 10_000 });
    await expect(timeline).toContainText("nuScenes mini scene-0061");
    await expect(page.getByTestId("scene-timeline-frame-0")).toHaveAttribute(
      "aria-current",
      "step",
    );

    const firstCard = page.locator('[data-testid^="box-list-item-"]').first();
    await firstCard.click({ position: { x: 12, y: 16 } });
    await expect(timeline).toContainText("当前对象轨迹");
    await expect(page.getByTestId("scene-timeline-track-frame-0")).toBeVisible();
    await expect(page.getByTestId("scene-timeline-track-frame-1")).toBeVisible();

    await expect.poll(() => pcdRequestCount).toBe(2);
    await page.getByTestId("scene-timeline-frame-1").click();
    await expect(page).toHaveURL(new RegExp(`task=${lidar.lidar_task_ids[1]}`));
    await expect(page.getByTestId("pointcloud-loading")).toBeVisible();
    expect(
      await page.getByTestId("pc-viewport").evaluate((element) => {
        const scene = (
          element as HTMLElement & {
            __pointCloudScene?: { getPointPositions: () => Float32Array | null };
          }
        ).__pointCloudScene;
        return scene?.getPointPositions() ?? null;
      }),
    ).toBeNull();
    releaseTargetPcd?.();
    await expect(page.getByTestId("scene-timeline-frame-1")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(page.locator('[data-testid^="box-list-item-"]').first()).toHaveClass(
      /border-brand/,
    );
    await expect(timeline).toContainText("当前对象轨迹");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__pointCloudColorWorkerCount ?? 0)).toBe(1);
    await expect(page.getByText("相机上色…")).toBeHidden();

    const toggle = page.getByTestId("scene-timeline-toggle");
    await toggle.click();
    await expect(page.getByTestId("scene-timeline-virtual-canvas")).toBeHidden();
    await toggle.click();
    await expect(page.getByTestId("scene-timeline-virtual-canvas")).toBeVisible();
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible();

    expect(timelineRequests.length).toBeGreaterThan(0);
    for (const requestUrl of timelineRequests) {
      const url = new URL(requestUrl);
      const start = Number(url.searchParams.get("start_frame"));
      const end = Number(url.searchParams.get("end_frame"));
      expect(end - start + 1).toBeLessThanOrEqual(200);
    }
    expect(annotationReads.length, "只应读取进入过的两个 task，不得逐帧 N+1").toBeLessThanOrEqual(
      2,
    );
    expect(pcdRequestCount, "邻帧预取与当前帧加载应复用同一个 PCD 请求").toBe(2);
  });

  test("点选 box_3d → PSR 面板出现 → 改 cx → 几何 PATCH 落库", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const sourceUrl = msg.location().url;
      consoleErrors.push(sourceUrl ? `${msg.text()} (${sourceUrl})` : msg.text());
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

  test("放大相机拖动中心手柄 → 共享草稿预览 → 松手单次 PATCH，可撤销与取消", async ({
    page,
    seed,
  }) => {
    test.setTimeout(60_000);
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 2200, height: 1080 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click({ position: { x: 12, y: 16 } });
    await page.getByLabel("展开详情").click();
    const cx = page.getByLabel("cx", { exact: true });
    await expect(cx).toHaveValue("1");

    const collapsedCamera = page.getByTitle("展开相机").first();
    if (await collapsedCamera.isVisible()) await collapsedCamera.click();
    const enlargeCamera = page.getByTitle("放大相机").first();
    await expect(enlargeCamera).toBeVisible({ timeout: 10_000 });
    await enlargeCamera.click();
    const canvas = page.getByLabel(/相机投影，拖动中心手柄微调 3D 框/);
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width))
      .toBeGreaterThan(0);

    const patches: Array<{
      geometry?: { type?: string; center?: number[]; size?: number[]; rotation?: number[] };
    }> = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && /\/annotations\/[0-9a-f-]+/.test(request.url())) {
        patches.push(request.postDataJSON());
      }
    });

    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("放大相机 canvas boundingBox 不可用");
    // fixture: 640×480, K=[fx=100,fy=100,cx=320,cy=240], box center=[1,0,1]
    // → 投影中心=[420,240]，即显示画布的 65.625% / 50%。
    const handleX = bounds.x + bounds.width * (420 / 640);
    const handleY = bounds.y + bounds.height * 0.5;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 64, handleY, { steps: 8 });

    expect(patches, "pointerup 前不得提交 PATCH").toHaveLength(0);
    await expect.poll(async () => Number(await cx.inputValue())).toBeGreaterThan(1.2);

    await page.mouse.up();
    await expect.poll(() => patches.length).toBe(1);
    await page.waitForTimeout(350);
    expect(patches, `中心手柄松手后只能保存一次: ${JSON.stringify(patches)}`).toHaveLength(1);
    expect(patches[0].geometry?.type).toBe("box_3d");
    expect(patches[0].geometry?.center?.[0]).toBeGreaterThan(1.2);
    expect(patches[0].geometry?.center?.[1]).toBeCloseTo(0, 5);
    expect(patches[0].geometry?.center?.[2]).toBeCloseTo(1, 5);
    expect(patches[0].geometry?.size).toEqual([4, 2, 1.5]);
    expect(patches[0].geometry?.rotation).toEqual([0, 0, 0]);

    await page.keyboard.press("Control+z");
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1].geometry?.center).toEqual([1, 0, 1]);
    await expect(cx).toHaveValue("1");

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width + 24, handleY, { steps: 6 });
    await expect(cx).toHaveValue("1");
    await page.mouse.up();
    expect(patches, "拖出画布取消不得新增 PATCH").toHaveLength(2);

    if ((await canvas.count()) === 0) await page.getByTitle("放大相机").first().click();
    const switchCanvas = page.getByLabel(/^front 相机投影，拖动中心手柄微调 3D 框/);
    await expect(switchCanvas).toBeVisible();
    const switchBounds = await switchCanvas.boundingBox();
    if (!switchBounds) throw new Error("切换相机前 canvas boundingBox 不可用");
    const switchHandleX = switchBounds.x + switchBounds.width * (420 / 640);
    const switchHandleY = switchBounds.y + switchBounds.height * 0.5;
    await page.mouse.move(switchHandleX, switchHandleY);
    await page.mouse.down();
    await page.mouse.move(switchHandleX + 32, switchHandleY, { steps: 4 });
    await page.getByTitle("下一视角").evaluate((button) => (button as HTMLButtonElement).click());
    await expect(cx).toHaveValue("1");
    await page.mouse.up();
    expect(patches, "拖动中切换相机不得新增 PATCH").toHaveLength(2);

    if ((await canvas.count()) === 0) {
      await page.getByTitle("放大相机").first().click();
    } else {
      await page.getByTitle("上一视角").click();
    }
    const restoredCanvas = page.getByLabel(/^front 相机投影，拖动中心手柄微调 3D 框/);
    await expect(restoredCanvas).toBeVisible();
    await page.waitForTimeout(100);
    const restoredBounds = await restoredCanvas.boundingBox();
    if (!restoredBounds) throw new Error("切回 front 后放大相机 canvas boundingBox 不可用");
    const restoredHandleX = restoredBounds.x + restoredBounds.width * (420 / 640);
    const restoredHandleY = restoredBounds.y + restoredBounds.height * 0.5;
    await page.mouse.move(restoredHandleX, restoredHandleY);
    await page.mouse.down();
    await page.mouse.move(restoredHandleX - 48, restoredHandleY, { steps: 6 });
    await expect.poll(async () => Number(await cx.inputValue())).toBeLessThan(0.9);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /关闭/ })).toBeVisible();
    await expect(cx).toHaveValue("1");
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(patches, "Escape 取消不得新增 PATCH").toHaveLength(2);
  });

  test("相机种框一次激活 → 连续创建两个框 → 保存期拒绝重复拖动", async ({ page, seed }) => {
    test.setTimeout(60_000);
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    const collapsedCamera = page.getByTitle("展开相机").first();
    if (await collapsedCamera.isVisible()) await collapsedCamera.click();
    await page.getByTitle("放大相机").first().click();
    await page.getByRole("button", { name: "种框 ⊹" }).click();
    await expect(page.getByRole("button", { name: /连续种框.*拖矩形/ })).toBeVisible();

    const modalBody = page.getByRole("button", { name: "关闭 ✕" }).locator("..");
    const cameraCanvas = modalBody.getByLabel(/^front 相机投影$/);
    await expect(cameraCanvas).toBeVisible();
    await expect
      .poll(() => cameraCanvas.evaluate((element) => (element as HTMLCanvasElement).width))
      .toBeGreaterThan(0);
    const bounds = await cameraCanvas.boundingBox();
    if (!bounds) throw new Error("放大相机 canvas boundingBox 不可用");
    const start = { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.35 };
    const end = { x: bounds.x + bounds.width * 0.62, y: bounds.y + bounds.height * 0.68 };

    let releaseFirstRequest: (() => void) | null = null;
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let boxPostCount = 0;
    await page.route("**/api/v1/tasks/*/annotations", async (route) => {
      if (route.request().method() === "POST") {
        boxPostCount += 1;
        if (boxPostCount === 1) await firstRequestGate;
      }
      await route.continue();
    });

    const firstResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/annotations$/.test(response.url()),
      { timeout: 10_000 },
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: /正在保存/ })).toBeVisible();
    await expect(cameraCanvas).toHaveAttribute("aria-disabled", "true");

    await page.mouse.move(start.x + 12, start.y + 12);
    await page.mouse.down();
    await page.mouse.move(end.x + 12, end.y + 12, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(boxPostCount, "相机保存期间的额外拖框不得发 POST").toBe(1);

    releaseFirstRequest?.();
    await firstResponse;
    await expect(page.getByRole("button", { name: /连续种框.*拖矩形/ })).toBeVisible();
    await expect(cameraCanvas).not.toHaveAttribute("aria-disabled", "true");

    const secondResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/annotations$/.test(response.url()),
      { timeout: 10_000 },
    );
    await page.mouse.move(start.x + 20, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x + 20, end.y, { steps: 6 });
    await page.mouse.up();
    await secondResponse;
    expect(boxPostCount).toBe(2);
    await expect(page.locator('[data-testid^="box-list-item-"]')).toHaveCount(3);
    await expect(page.getByRole("button", { name: /连续种框.*拖矩形/ })).toBeVisible();

    await page.keyboard.press("v");
    await expect(page.getByRole("button", { name: "种框 ⊹" })).toBeVisible();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(boxPostCount).toBe(2);
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

    // 真实 nuScenes 的传感器盲区覆盖 ego 原点；把固定 seed 框移到首帧真实点密集区，
    // 避免 Q 因框内无点而被等值更新短路。CI profile 在固定框内自带目标点，无需搬移。
    if (lidar.lidar_fixture_source === "nuscenes_mini") {
      await page.getByLabel("展开详情").click();
      const setupPatch = page.waitForRequest(
        (req) => {
          if (req.method() !== "PATCH" || !/\/annotations\/[0-9a-f-]+/.test(req.url())) {
            return false;
          }
          const geometry = (
            req.postDataJSON() as { geometry?: { center?: number[]; size?: number[] } }
          ).geometry;
          return geometry?.center?.[0] === 5 && geometry.size?.[2] === 4;
        },
        { timeout: 10_000 },
      );
      await page.getByLabel("cx", { exact: true }).fill("5");
      await page.getByLabel("cy", { exact: true }).fill("-1");
      await page.getByLabel("cz", { exact: true }).fill("-1");
      await page.getByLabel("l", { exact: true }).fill("4");
      await page.getByLabel("w", { exact: true }).fill("4");
      await page.getByLabel("h", { exact: true }).fill("4");
      await setupPatch;
      await card.click({ position: { x: 12, y: 16 } });
    }

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
    await focusPointCloudBox(page, card);
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
    for (const [dx, dy] of [
      [0, 0],
      [30, 0],
      [0, 30],
      [-30, 0],
      [0, -30],
      [20, 20],
    ]) {
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

  test("选择工具双击框 → 单选并聚焦，不产生 annotation 写请求", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    const annotationWrites: string[] = [];
    page.on("request", (request) => {
      if (
        ["POST", "PATCH", "DELETE"].includes(request.method()) &&
        /\/annotations(?:\/|\?|$)/.test(request.url())
      ) {
        annotationWrites.push(`${request.method()} ${request.url()}`);
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "俯视" }).click();

    const card = page.locator('[data-testid^="box-list-item-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const hit = await pointCloudBoxScreenPoint(page, card);
    await page.mouse.dblclick(hit.x, hit.y);

    await expect(page.getByLabel("展开详情")).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);
    expect(annotationWrites).toEqual([]);
  });

  test("三视图按对象和视图记忆离散缩放，触控板小 delta 先累计", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

    await page.locator("body").click();
    await page.keyboard.press("b");
    const mainCanvas = page.locator("canvas").first();
    const mainBounds = await mainCanvas.boundingBox();
    if (!mainBounds) throw new Error("主点云 canvas boundingBox 不可用");
    await page.mouse.click(
      mainBounds.x + mainBounds.width * 0.7,
      mainBounds.y + mainBounds.height * 0.6,
    );
    const cards = page.locator('[data-testid^="box-list-item-"]');
    await expect(cards).toHaveCount(2, { timeout: 10_000 });

    await cards.first().click({ position: { x: 12, y: 16 } });
    const top = page.getByLabel(/^俯视精修视图/);
    await expect(top).toHaveAttribute("aria-label", /缩放 100%/);
    for (let i = 0; i < 3; i += 1) {
      await top.dispatchEvent("wheel", { deltaY: -20, deltaMode: 0 });
    }
    await expect(top).toHaveAttribute("aria-label", /缩放 100%/);
    await top.dispatchEvent("wheel", { deltaY: -20, deltaMode: 0 });
    await expect(top).toHaveAttribute("aria-label", /缩放 112%/);

    await cards.nth(1).click({ position: { x: 12, y: 16 } });
    await expect(page.getByLabel(/^俯视精修视图/)).toHaveAttribute("aria-label", /缩放 100%/);
    const side = page.getByLabel(/^侧视精修视图/);
    await side.focus();
    await page.keyboard.press("=");
    await expect(side).toHaveAttribute("aria-label", /缩放 112%/);

    await cards.first().click({ position: { x: 12, y: 16 } });
    await expect(page.getByLabel(/^俯视精修视图/)).toHaveAttribute("aria-label", /缩放 112%/);
    await expect(page.getByLabel(/^侧视精修视图/)).toHaveAttribute("aria-label", /缩放 100%/);
  });

  test("三套布局预设一次点击恢复三视图和相机面板，不切换当前工具", async ({ page, seed }) => {
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    await page
      .locator('[data-testid^="box-list-item-"]')
      .first()
      .click({ position: { x: 12, y: 16 } });
    await page.waitForTimeout(200);
    const cameraBefore = await readPointCloudViewState(page);

    await page.getByRole("button", { name: "恢复点级分割布局" }).click();
    await expect(page.getByLabel("展开三视图精修(可拖动)")).toBeVisible();
    await expect(page.getByTestId("pointmask-mode-select")).toHaveCount(0);

    const sensorFusionSave = page.waitForRequest(
      (request) => {
        if (
          request.method() !== "PATCH" ||
          !request.url().endsWith("/api/v1/auth/me/preferences")
        ) {
          return false;
        }
        const body = request.postDataJSON() as {
          workbench?: { layout?: { cameraPanels?: Record<string, unknown> } };
        };
        return Object.keys(body.workbench?.layout?.cameraPanels ?? {}).length === 0;
      },
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "恢复传感器融合布局" }).click();
    await expect(page.getByLabel("展开三视图精修(可拖动)")).toBeVisible();
    const sensorFusionBody = (await sensorFusionSave).postDataJSON() as {
      workbench?: {
        layout?: {
          cameraPanels?: Record<string, unknown>;
          triViewFloat?: { collapsed?: boolean };
        };
      };
    };
    expect(sensorFusionBody.workbench?.layout?.cameraPanels).toEqual({});
    expect(sensorFusionBody.workbench?.layout?.triViewFloat?.collapsed).toBe(true);
    await expect(page.getByTitle("展开相机").first()).toBeVisible();

    await page.getByRole("button", { name: "恢复框体精修布局" }).click();
    await expect(page.getByText("三视图精修", { exact: true })).toBeVisible();
    await expect(page.getByTitle("展开相机").first()).toBeVisible();
    const cameraAfter = await readPointCloudViewState(page);
    expectPointCloudViewStateClose(cameraAfter, cameraBefore);
  });

  test("布局预设在目标视口与 0/1/2/6 路相机下不遮挡关键入口", async ({ page, seed }) => {
    test.setTimeout(90_000);
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");
    let cameraCount = 0;

    await page.route("**/api/v1/tasks/*/point-cloud/manifest", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        cameras: Array<Record<string, unknown>>;
        [key: string]: unknown;
      };
      const sources = body.cameras;
      await route.fulfill({
        response,
        json: {
          ...body,
          cameras: Array.from({ length: cameraCount }, (_, index) => ({
            ...sources[index % Math.max(sources.length, 1)],
            name: `matrix-camera-${index + 1}`,
            role: `matrix-role-${index + 1}`,
          })),
        },
      });
    });

    const matrix = [
      { count: 0, width: 1366, height: 768, closeSidebar: false, selectBox: false },
      { count: 1, width: 1920, height: 1080, closeSidebar: true, selectBox: true },
      { count: 2, width: 1366, height: 768, closeSidebar: true, selectBox: true },
      { count: 6, width: 1920, height: 1080, closeSidebar: false, selectBox: false },
    ];

    for (const item of matrix) {
      cameraCount = item.count;
      await page.setViewportSize({ width: item.width, height: item.height });
      await page.goto(`/projects/${lidar.lidar_project_id}/annotate`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });

      const expandDetails = page.getByRole("button", { name: "展开标注详情" });
      if ((item.selectBox || !item.closeSidebar) && (await expandDetails.isVisible())) {
        await expandDetails.click();
      }
      if (item.selectBox) {
        await page
          .locator('[data-testid^="box-list-item-"]')
          .first()
          .click({
            position: { x: 12, y: 16 },
          });
      }
      const collapseDetails = page.getByRole("button", { name: "收起标注详情" });
      if (item.closeSidebar && (await collapseDetails.isVisible())) await collapseDetails.click();

      await page.getByRole("button", { name: "恢复点级分割布局" }).click();
      await expect(page.getByTitle("展开相机")).toHaveCount(item.count);
      await page.getByRole("button", { name: "恢复传感器融合布局" }).click();
      await page.getByRole("button", { name: "恢复框体精修布局" }).click();

      for (const name of ["恢复框体精修布局", "恢复传感器融合布局", "恢复点级分割布局"]) {
        await expectCenterHitTarget(page.getByRole("button", { name }));
      }
      for (const name of ["上一", "提交质检", "跳过", "下一"]) {
        await expectCenterHitTarget(page.getByRole("button", { name, exact: true }));
      }
    }
  });

  test("关闭持久化时同 scene 切帧仍恢复运行时相机", async ({ page, seed }) => {
    test.setTimeout(60_000);
    await seed.reset();
    const lidar = await seed.seedLidar();
    await seed.injectToken(page, "admin@e2e.test");
    const [firstTaskId, secondTaskId] = lidar.lidar_task_ids;

    await page.route("**/api/v1/tasks/*/point-cloud/manifest", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      const taskId = route
        .request()
        .url()
        .match(/\/tasks\/([^/]+)\/point-cloud/)?.[1];
      const frameIndex = taskId === secondTaskId ? 1 : 0;
      await route.fulfill({
        response,
        json: {
          ...body,
          scene_id: "00000000-0000-0000-0000-000000000024",
          scene_name: "e2e-camera-continuity",
          frame_index: frameIndex,
          scene_total_frames: 2,
          point_cloud_url: `${String(body.point_cloud_url)}#frame-${frameIndex}`,
        },
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${lidar.lidar_project_id}/annotate?task=${firstTaskId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("pointcloud-stats")).toBeVisible({ timeout: 20_000 });
    const defaultView = await readPointCloudViewState(page);
    const canvas = page.locator("canvas").first();
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("主点云 canvas boundingBox 不可用");
    await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.42, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(async () => JSON.stringify(await readPointCloudViewState(page)))
      .not.toBe(JSON.stringify(defaultView));
    const before = await waitForPointCloudViewStable(page);

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/tasks/${secondTaskId}/point-cloud/manifest`) && response.ok(),
    );
    await page.getByText(/e2e-lidar-.*-1\.pcd/, { exact: true }).click();
    await responsePromise;
    await expect.poll(() => page.url()).toContain(secondTaskId);
    const after = await waitForPointCloudViewStable(page);
    expectPointCloudViewStateClose(after, before);
  });
});
