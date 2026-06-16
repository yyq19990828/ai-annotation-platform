/**
 * 流程录制：视频时序追踪工作台(video-track)概览 —— 逐帧前进 + 播放。
 *
 * 输出：outputs/flows/video-track.gif → docs-site/.../workbench/video-track-overview.gif
 *
 * 数据来自 seed_video.py 建的开源项目 P-VIDEO-DEV（行车跟踪 tracking_car.mp4，h264，
 * 335 帧）。本 flow 不落任何标注（纯浏览：选 hand 工具避免误画 → ArrowRight 逐帧 → Space 播放），
 * 故无需 afterAll 清理。
 *
 * 项目 id 不在 seed/peek（peek 只给默认项目），用 admin token 调 REST 解析 P-VIDEO-DEV 的
 * project_id 与首个 task id。视频帧 chunk 首开是 pending（worker 异步切片），前端回退到
 * 直链 mp4 播放，故 Space 立即有运动，不必等 chunk ready。
 *
 * 返回 { drawStartMs, drawEndMs }：供 finalize 裁掉开头(导航/解析/就绪等待)。
 */
import type { Page } from "@playwright/test";
import type { DrawWindow } from "./rotated-bbox";

const API = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

/**
 * 收起工作台左右边栏（任务列表 / 标注详情），让录制聚焦视频画面。
 * 两个切换钮在 Topbar，展开时 title 为「收起任务列表」/「收起标注详情」（收起后变「展开…」），
 * 按 title 点击只在仍展开时命中，幂等。收起后 stage 容器变宽，等一拍让 video stage 重新适应。
 */
async function collapseSidebars(page: Page): Promise<void> {
  for (const title of ["收起任务列表", "收起标注详情"]) {
    const btn = page.getByTitle(title);
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(400);
}

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

export async function runVideoTrack(page: Page, adminEmail: string): Promise<DrawWindow | null> {
  const resolved = await resolveVideoProject(page, adminEmail);
  if (!resolved) {
    console.warn("[video-track] 无法解析 P-VIDEO-DEV（seed_video 未跑？），跳过");
    return null;
  }
  const { projectId, taskId } = resolved;
  const task = taskId ? `?task=${taskId}` : "";
  await page.goto(`/projects/${projectId}/annotate${task}`);
  await page.waitForLoadState("networkidle");

  // 等时间轴就绪（manifest 加载完成的信号）+ 首帧画面解码。
  await page.getByTestId("video-timeline-shell").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2200);

  // 收起左右边栏，画面聚焦视频本身（边栏默认展开，点 Topbar 切换钮收起；收起后 stage 会重新适应窗口）。
  await collapseSidebars(page);

  // 选 hand(查看)工具：保证后续点击/按键不会误触发画框。
  const handBtn = page.getByTestId("video-tool-btn-hand");
  if (await handBtn.count()) {
    await handBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const drawStartMs = Date.now();

  // ── 逐帧前进 8 帧（展示帧级控制，画面里车辆逐帧移动）──
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);

  // ── 播放约 3.5s（展示时间轴播放头推进 + 真实运动）──
  await page.keyboard.press("Space");
  await page.waitForTimeout(3500);
  await page.keyboard.press("Space"); // 暂停
  await page.waitForTimeout(700);

  const drawEndMs = Date.now();
  return { drawStartMs, drawEndMs };
}
