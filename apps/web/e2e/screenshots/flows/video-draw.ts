/**
 * 流程录制：视频时序工作台画框追踪(video-draw) —— track 工具画 2 个关键帧, 中间帧线性插值。
 *
 * 输出：outputs/flows/video-draw.gif → docs-site/.../workbench/video-track-trajectory.gif
 *
 * 数据来自 seed_video.py 的 P-VIDEO-DEV(开源行车 tracking_car.mp4)。演示"轨迹"概念:
 * 选 track 工具 → 第 0 帧画框(新建 track, 关键帧0)→ 前进若干帧 → 再画框(自动 upsert 关键帧)
 * → 两关键帧间逐帧前进时 bbox 线性插值平滑移动。
 *
 * 落库:geometry.type=video_track_bbox(或单帧 video_bbox), 由 flows.spec afterAll 按
 * display_id='P-VIDEO-DEV' 清理。
 *
 * 盲坐标:视频用 SVG 叠加层, 画框落点取 video-stage-surface 的 boundingBox 再按比例算客户端坐标
 * (finishDrag 内部 clientPointToVideoPoint 会把客户端坐标转成归一化 [0,1])。
 *
 * 返回 { drawStartMs, drawEndMs }:供 finalize 裁掉开头(导航/解析/就绪等待)。
 */
import type { Page } from "@playwright/test";
import type { DrawWindow } from "./rotated-bbox";

const API = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

/** 用 admin token 解析 P-VIDEO-DEV 的 project_id 与首个 task id。 */
async function resolveVideoProject(
  page: Page,
  adminEmail: string,
): Promise<{ projectId: string; taskId: string | null } | null> {
  const login = await page.request.post(`${API}/api/v1/__test/seed/login`, {
    data: { email: adminEmail },
  });
  if (!login.ok()) return null;
  const token = (await login.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };

  const projRes = await page.request.get(`${API}/api/v1/projects?data_type=video`, { headers });
  if (!projRes.ok()) return null;
  const projBody = await projRes.json();
  const projects = Array.isArray(projBody) ? projBody : (projBody.items ?? []);
  const proj = projects.find((p: { display_id?: string }) => p.display_id === "P-VIDEO-DEV");
  if (!proj) return null;

  const taskRes = await page.request.get(
    `${API}/api/v1/tasks?project_id=${proj.id}&limit=1`,
    { headers },
  );
  const taskBody = taskRes.ok() ? await taskRes.json() : null;
  const tasks = Array.isArray(taskBody) ? taskBody : (taskBody?.items ?? []);
  return { projectId: proj.id as string, taskId: (tasks?.[0]?.id as string) ?? null };
}

export async function runVideoDraw(page: Page, adminEmail: string): Promise<DrawWindow | null> {
  const resolved = await resolveVideoProject(page, adminEmail);
  if (!resolved) {
    console.warn("[video-draw] 无法解析 P-VIDEO-DEV(seed_video 未跑?), 跳过");
    return null;
  }
  const { projectId, taskId } = resolved;
  const task = taskId ? `?task=${taskId}` : "";
  await page.goto(`/projects/${projectId}/annotate${task}`);
  await page.waitForLoadState("domcontentloaded");

  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 选 track(跨帧轨迹)工具:画框会建/扩展 track 关键帧并自动插值。
  const trackBtn = page.getByTestId("video-tool-btn-track");
  if (await trackBtn.count()) {
    await trackBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // 取视频画布区域, 用其 boundingBox 算落点(客户端像素), finishDrag 内部转归一化。
  const surface = page.getByTestId("video-stage-surface");
  const box = await surface.boundingBox();
  if (!box) {
    console.warn("[video-draw] 找不到 video-stage-surface, 跳过");
    return null;
  }
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  const drawStartMs = Date.now();

  // ── 第 0 帧:画第一个框(新建 track, 关键帧 @0)──
  const a0 = at(0.34, 0.42);
  const a1 = at(0.5, 0.66);
  await page.mouse.move(a0.x, a0.y);
  await page.mouse.down();
  await page.mouse.move((a0.x + a1.x) / 2, (a0.y + a1.y) / 2, { steps: 6 });
  await page.mouse.move(a1.x, a1.y, { steps: 6 });
  await page.mouse.up();
  // 画完弹 ClassPickerPopover, Enter 用默认类别提交(否则停在 pending draft 不落库)。
  await page.getByTestId("class-picker-popover").waitFor({ timeout: 3000 }).catch(() => {});
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);

  // ── 前进 8 帧:此间该 track 暂无第二关键帧, 框停留(展示帧推进)──
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(500);

  // ── 第 8 帧:再画一个框(track 已选中, upsert 关键帧 @8, 位置右移演示运动)──
  const b0 = at(0.5, 0.36);
  const b1 = at(0.66, 0.6);
  await page.mouse.move(b0.x, b0.y);
  await page.mouse.down();
  await page.mouse.move((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, { steps: 6 });
  await page.mouse.move(b1.x, b1.y, { steps: 6 });
  await page.mouse.up();
  // track 工具已选中该 track 时, 第二次画框是 upsert 关键帧, 通常不再弹 popover;
  // 若弹(被当作新 pending)仍 Enter 兜底提交。
  await page.getByTestId("class-picker-popover").waitFor({ timeout: 1500 }).catch(() => {});
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);

  // ── 回到第 0 帧再逐帧前进:展示两关键帧间 bbox 线性插值平滑移动 ──
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(260);
  }
  await page.waitForTimeout(900);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
