/**
 * 流程录制：点云工作台控件演示(pointcloud-controls) —— 相机上色 / 点大小 / 深度提示。
 *
 * 输出：outputs/flows/pointcloud-controls.gif → docs-site/.../workbench/pointcloud-controls-bar.gif
 *
 * 数据来自 seed_nuscenes_scene 建的 P-NU-nuscenes-mini(nuScenes-mini, lidar+6 路相机)。选 nuScenes
 * 是因为它带相机标定/图像, 「相机上色」才能把点云真实采样成 RGB(纯 lidar 的 P-PC-DEV 无相机, 上色
 * 无视觉效果)。这些控件不在画面浮条上, 而在「工作台设置」抽屉的「点云」分类里(toggle/slider)。
 * 本 flow 纯切设置不落标注, 设置走 localStorage(每次全新 context 默认态), 故无需 afterAll 清理。
 *
 * 项目 id 不在 seed/peek, 用 admin token 调 REST 解析 P-NU-nuscenes-mini 的 project_id 与首个 task id。
 * 点云 PCD 由前端按需加载并经 WebGL(headless 走 SwiftShader)渲染, 故进入后多等一段让点云就绪。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(导航/解析/点云加载等待)。
 */
import type { Page } from "@playwright/test";
import type { DrawWindow } from "./rotated-bbox";

const API = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

/** 用 admin token 解析 P-NU-nuscenes-mini 的 project_id 与首个 task id。 */
async function resolvePointcloudProject(
  page: Page,
  adminEmail: string,
): Promise<{ projectId: string; taskId: string | null } | null> {
  const login = await page.request.post(`${API}/api/v1/__test/seed/login`, {
    data: { email: adminEmail },
  });
  if (!login.ok()) return null;
  const token = (await login.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };

  const projRes = await page.request.get(`${API}/api/v1/projects?data_type=lidar`, { headers });
  if (!projRes.ok()) return null;
  const projBody = await projRes.json();
  const projects = Array.isArray(projBody) ? projBody : (projBody.items ?? []);
  const proj = projects.find((p: { display_id?: string }) => p.display_id === "P-NU-nuscenes-mini");
  if (!proj) return null;

  const taskRes = await page.request.get(
    `${API}/api/v1/tasks?project_id=${proj.id}&limit=1`,
    { headers },
  );
  const taskBody = taskRes.ok() ? await taskRes.json() : null;
  const tasks = Array.isArray(taskBody) ? taskBody : (taskBody?.items ?? []);
  return { projectId: proj.id as string, taskId: (tasks?.[0]?.id as string) ?? null };
}

export async function runPointcloudControls(
  page: Page,
  adminEmail: string,
): Promise<DrawWindow | null> {
  const resolved = await resolvePointcloudProject(page, adminEmail);
  if (!resolved) {
    console.warn("[pointcloud-controls] 无法解析 P-NU-nuscenes-mini(seed nuScenes 未跑?), 跳过");
    return null;
  }
  const { projectId, taskId } = resolved;
  const task = taskId ? `?task=${taskId}` : "";
  await page.goto(`/projects/${projectId}/annotate${task}`);
  // 点云工作台持续渲染 + 可能轮询, networkidle 不会稳定 settle; 用 domcontentloaded + 显式等待。
  await page.waitForLoadState("domcontentloaded");

  // 等 3D 视口挂载 + 点云经 WebGL 渲染(PCD 异步加载, SwiftShader 较慢, 多等一段)。
  await page.getByTestId("pc-viewport").waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const drawStartMs = Date.now();

  // ── 打开工作台设置抽屉(Topbar 齿轮; 抽屉为右侧栏, 左侧 3D 视口仍可见)──
  await page.getByRole("button", { name: "工作台设置" }).first().click().catch(() => {});
  await page.getByTestId("workbench-settings-drawer").waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);

  // ── 相机上色 ON：点云从高度色 → 采样相机 RGB(左侧视口实时变色)──
  // 点字段 <label> 本身切换(内嵌 checkbox 视觉隐藏不可直接点; 原生 label 行为转发到它)。
  const colorize = page.getByTestId("setting-field-pointcloud.colorizeWithCamera");
  await colorize.scrollIntoViewIfNeeded().catch(() => {});
  await colorize.click().catch(() => {});
  await page.waitForTimeout(1600);

  // ── 点大小调大：拖滑块(键盘步进)放大点径, 点云更饱满 ──
  const sizeSlider = page
    .getByTestId("setting-field-pointcloud.pointSize")
    .getByRole("slider");
  await sizeSlider.scrollIntoViewIfNeeded().catch(() => {});
  await sizeSlider.focus().catch(() => {});
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(900);

  // ── 深度提示 ON：相机视图叠加深度热力 ──
  const depth = page.getByTestId("setting-field-pointcloud.showDepthHint");
  await depth.scrollIntoViewIfNeeded().catch(() => {});
  await depth.click().catch(() => {});
  await page.waitForTimeout(1400);

  // ── 关抽屉, 露出完整重着色 + 放大后的点云, 停留展示 ──
  await page.keyboard.press("Escape");
  await page.waitForTimeout(2200);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
