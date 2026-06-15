/**
 * canvas 流程录制共享工具。
 */
import type { Page } from "@playwright/test";

const API = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000";

/**
 * 用 admin token 按 display_id='P-COCO8' 解析图片项目 + 首个 task。
 *
 * 不走 seed/peek：peek 现在可能返回视频项目 P-VIDEO-DEV（进的是视频工作台，没有
 * 普通画布工具按钮），用它定位画布 flow 会静默录到空内容。改按 display_id 自解析，
 * 与视频/点云 flow 同思路（见 video-draw.ts）。
 */
export async function resolveCoco8Project(
  page: Page,
  adminEmail: string,
): Promise<{ projectId: string; taskId: string | null } | null> {
  const login = await page.request.post(`${API}/api/v1/__test/seed/login`, {
    data: { email: adminEmail },
  });
  if (!login.ok()) return null;
  const token = (await login.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };

  const projRes = await page.request.get(`${API}/api/v1/projects?data_type=image`, { headers });
  if (!projRes.ok()) return null;
  const projBody = await projRes.json();
  const projects = Array.isArray(projBody) ? projBody : (projBody.items ?? []);
  const proj = projects.find((p: { display_id?: string }) => p.display_id === "P-COCO8");
  if (!proj) return null;

  const taskRes = await page.request.get(
    `${API}/api/v1/tasks?project_id=${proj.id}&limit=1`,
    { headers },
  );
  const taskBody = taskRes.ok() ? await taskRes.json() : null;
  const tasks = Array.isArray(taskBody) ? taskBody : (taskBody?.items ?? []);
  return { projectId: proj.id as string, taskId: (tasks?.[0]?.id as string) ?? null };
}

/**
 * 解析 P-COCO8 → 导航到其标注工作台 → 等 networkidle。
 * 解析失败返回 false（调用方应 warn + return null）。
 */
export async function openCoco8Annotate(page: Page, adminEmail: string): Promise<boolean> {
  const resolved = await resolveCoco8Project(page, adminEmail);
  if (!resolved) return false;
  const task = resolved.taskId ? `?task=${resolved.taskId}` : "";
  await page.goto(`/projects/${resolved.projectId}/annotate${task}`);
  await page.waitForLoadState("networkidle");
  return true;
}

/**
 * 隐藏所有预测来源（取消 AI 面板「预测来源筛选」里仍勾选且可点的来源）。
 *
 * COCO8 任务满屏 external_import 预测框，绘制工具的指针手势会落在预测框上触发
 * 「采纳/驳回」浮层而画不出新形状；先把预测隐藏，画布干净后再绘制。
 */
export async function hidePredictions(page: Page): Promise<void> {
  const card = page.locator('[aria-label="预测来源筛选"]');
  await card.waitFor({ timeout: 4000 }).catch(() => {});
  if (!(await card.count())) return;
  // 逐个取消勾选（每次取消后 :checked 集合变化，始终取第一个仍勾选且未禁用的）
  for (let i = 0; i < 4; i++) {
    const checkbox = card.locator('input[type="checkbox"]:checked:not([disabled])').first();
    if (!(await checkbox.count())) break;
    await checkbox.click().catch(() => {});
    await page.waitForTimeout(350);
  }
}
