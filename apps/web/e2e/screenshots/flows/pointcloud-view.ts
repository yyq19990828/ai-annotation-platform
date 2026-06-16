/**
 * 流程录制：点云视图导航(pointcloud-view) —— 拖动主 3D 视图旋转点云(orbit)。
 *
 * 输出：outputs/flows/pointcloud-view.gif → docs-site/.../workbench/pointcloud-view-orbit.gif
 *
 * 数据复用 pointcloud-controls 的 P-NU-nuscenes-mini(nuScenes-mini, lidar)。本 flow 纯导航(不开
 * 任何工具、不落标注)：默认模式下 OrbitControls 左键 = ROTATE, 在 pc-viewport 内左键拖拽即沿轨道
 * 环绕点云, 再滚轮拉近一档。设置走 localStorage(每次全新 context 默认态), 故无需 afterAll 清理。
 *
 * 录制聚焦点云本身, 故先收起左右边栏(任务列表 / 标注详情)再拖拽, 让 3D 视口占满画面。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(导航/解析/点云加载等待 + 收边栏)。
 */
import type { Page } from "@playwright/test";
import type { DrawWindow } from "./rotated-bbox";
import { resolvePointcloudProject } from "./pointcloud-controls";

/**
 * 收起工作台左右边栏(任务列表 / 标注详情), 让 3D 视口占满画面。
 * 两个切换钮在 Topbar, 展开时 title 为「收起任务列表」/「收起标注详情」(收起后变「展开…」),
 * 按 title 点击只在仍展开时命中, 幂等。收起后视口变宽, 等一拍让 3D 场景重新适应尺寸。
 */
async function collapseSidebars(page: Page): Promise<void> {
  for (const title of ["收起任务列表", "收起标注详情"]) {
    const btn = page.getByTitle(title);
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(500);
}

/** 在 pc-viewport 内做一次左键拖拽(orbit), from→to 之间分 steps 步平滑移动。 */
async function dragOrbit(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  from: { dx: number; dy: number },
  to: { dx: number; dy: number },
  // 点云每帧重渲染让单次 mouse.move 较慢, 步数不宜多, 否则单段拖拽就拖到数秒、GIF 过长。
  steps = 14,
): Promise<void> {
  const sx = box.x + box.width * from.dx;
  const sy = box.y + box.height * from.dy;
  const ex = box.x + box.width * to.dx;
  const ey = box.y + box.height * to.dy;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
    await page.waitForTimeout(18);
  }
  await page.mouse.up();
  await page.waitForTimeout(350);
}

export async function runPointcloudView(
  page: Page,
  adminEmail: string,
): Promise<DrawWindow | null> {
  const resolved = await resolvePointcloudProject(page, adminEmail);
  if (!resolved) {
    console.warn("[pointcloud-view] 无法解析 P-NU-nuscenes-mini(seed nuScenes 未跑?), 跳过");
    return null;
  }
  const { projectId, taskId } = resolved;
  const task = taskId ? `?task=${taskId}` : "";
  await page.goto(`/projects/${projectId}/annotate${task}`);
  // 点云工作台持续渲染 + 可能轮询, networkidle 不会稳定 settle; 用 domcontentloaded + 显式等待。
  await page.waitForLoadState("domcontentloaded");

  // 等 3D 视口挂载 + 点云经 WebGL 渲染(PCD 异步加载, SwiftShader 较慢, 多等一段)。
  const viewport = page.getByTestId("pc-viewport");
  await viewport.waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // 收起左右边栏, 画面聚焦点云(默认展开, 点 Topbar 切换钮收起; 收起后视口重新适应窗口)。
  await collapseSidebars(page);

  const box = await viewport.boundingBox();
  if (!box) {
    console.warn("[pointcloud-view] 取不到 pc-viewport 尺寸, 跳过拖拽");
    return null;
  }

  const drawStartMs = Date.now();

  // ── 左键拖拽 orbit：默认模式下 OrbitControls LEFT=ROTATE, 拖拽即沿轨道环绕点云 ──
  // 第一段：水平向右拖(绕竖直轴转), 视角横扫。
  await dragOrbit(page, box, { dx: 0.32, dy: 0.5 }, { dx: 0.7, dy: 0.42 });
  // 第二段：反向 + 略带俯仰, 让点云换个角度。
  await dragOrbit(page, box, { dx: 0.68, dy: 0.45 }, { dx: 0.35, dy: 0.62 });

  // ── 滚轮拉近一档(dolly), 展示缩放查看 ──
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
