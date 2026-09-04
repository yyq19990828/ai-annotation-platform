import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/seed";

async function layoutCommand(page: Page, name: string) {
  await page.getByRole("button", { name: "布局", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function panelCommand(page: Page, title: string, name: string) {
  await page.getByRole("button", { name: `${title}菜单`, exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function savedVideoWorkspace(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const response = await page.request.get("/api/v1/auth/me/preferences", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).workbench.layout.workspace.contexts["annotate:video"];
}

test("图片 AI 审阅预设显示单例面板，图片上下文不暴露视频追踪", async ({ page, seed }) => {
  const data = await seed.reset();
  await seed.injectToken(page, data.admin_email);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/projects/${data.project_id}/annotate?task=${data.task_ids[0]}`);
  await expect(page.getByTestId("workbench-stage")).toBeVisible({ timeout: 30_000 });

  const aiWrapper = page.locator('[data-workbench-panel="ai-task"]');
  const identity = await aiWrapper.elementHandle();
  await page.getByRole("button", { name: "布局", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "图片 AI 审阅布局" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "当前题 AI" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "视频追踪" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "图片 AI 审阅布局" }).click();

  await expect(page.getByTestId("ai-prediction-popover")).toBeVisible();
  expect(await aiWrapper.evaluate((node, original) => node === original, identity)).toBe(true);
  await panelCommand(page, "当前题 AI", "隐藏面板");
  await expect(aiWrapper).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("ai-prediction-popover")).toHaveCount(1);
  await page.getByTestId("workbench-ai-single").click();
  await expect(page.getByTestId("ai-prediction-popover")).toBeVisible();
  expect(await aiWrapper.evaluate((node, original) => node === original, identity)).toBe(true);
});

test("AI 与视频追踪使用同一 Dockview 工作区，隐藏和预设不重建业务内容", async ({ page, seed }) => {
  test.setTimeout(90_000);
  const data = await seed.reset();
  const video = await seed.videoTask(data.project_id);
  await seed.injectToken(page, data.admin_email);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);
  await expect(page.getByTestId("video-konva-stage")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("workbench-ai-tracker").click();
  const tracker = page.getByTestId("video-tracker-propagate-dialog");
  await expect(tracker).toBeVisible();
  await tracker.getByTestId("tracker-direction-backward").click();
  await expect(tracker.getByTestId("tracker-direction-backward")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const trackerWrapper = page.locator('[data-workbench-panel="video-tracker"]');
  const trackerIdentity = await trackerWrapper.elementHandle();

  await panelCommand(page, "视频追踪", "隐藏面板");
  await expect(trackerWrapper).toHaveAttribute("aria-hidden", "true");
  await expect(tracker).toHaveCount(1);
  await page.getByTestId("workbench-ai-tracker").click();
  await expect(tracker).toBeVisible();
  expect(
    await trackerWrapper.evaluate((node, original) => node === original, trackerIdentity),
  ).toBe(true);
  await expect(tracker.getByTestId("tracker-direction-backward")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("workbench-ai-single").click();
  const ai = page.getByTestId("ai-prediction-popover");
  await expect(ai).toBeVisible();
  await expect(tracker).toBeVisible();
  const aiWrapper = page.locator('[data-workbench-panel="ai-task"]');
  const aiIdentity = await aiWrapper.elementHandle();

  await layoutCommand(page, "视频追踪布局");
  await expect(tracker).toBeVisible();
  await expect(aiWrapper).toHaveAttribute("aria-hidden", "true");
  await expect(ai).toHaveCount(1);
  expect(
    await trackerWrapper.evaluate((node, original) => node === original, trackerIdentity),
  ).toBe(true);
  await page.getByTestId("workbench-ai-single").click();
  await expect(ai).toBeVisible();
  expect(await aiWrapper.evaluate((node, original) => node === original, aiIdentity)).toBe(true);

  await page.waitForTimeout(650);
  await expect
    .poll(async () => (await savedVideoWorkspace(page)).schemaVersion, { timeout: 20_000 })
    .toBe(3);
  const saved = await savedVideoWorkspace(page);
  expect(Object.keys(saved.snapshot.layout.panels).sort()).toEqual([
    "ai-task",
    "canvas",
    "class-palette",
    "discussion",
    "inspector",
    "task-queue",
    "video-tracker",
  ]);
  expect(saved.snapshot.visibilityIntent).toEqual({
    "ai-task": "shown",
    "video-tracker": "shown",
  });
});
