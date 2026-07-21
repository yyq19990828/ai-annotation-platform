import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

import { expect, test } from "../fixtures/seed";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";

interface AnnotationDto {
  id: string;
  version: number;
  geometry: {
    keyframes?: Array<{ frame_index: number; source?: string }>;
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function annotations(request: APIRequestContext, taskId: string, token: string) {
  const response = await request.get(
    `${API_BASE}/api/v1/tasks/${taskId}/annotations`,
    { headers: auth(token) },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as AnnotationDto[];
}

async function setWindow(page: Page, from: number, to: number) {
  await page.getByTestId("tracker-review-from-frame").fill(String(from));
  await page.getByTestId("tracker-review-to-frame").fill(String(to));
}

function decisionResponse(response: APIResponse) {
  return response.url().includes("/video-tracker-jobs/")
    && response.url().endsWith("/decisions")
    && response.request().method() === "POST";
}

test("Tracker 可按目标/帧窗局部接受拒绝并二次确认人工帧", async ({
  page,
  request,
  seed,
}) => {
  const data = await seed.reset();
  const video = await seed.videoTask(data.project_id);
  const fixture = await seed.trackerReview(video.task_id, data.admin_email);
  const token = await seed.accessToken(data.admin_email);
  await seed.injectToken(page, data.admin_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);

  const review = page.getByTestId("video-tracker-review-bar");
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review).toContainText("已审 0/10");

  // 仅接受 A 的 F10-F11；B 与窗口外必须保持不变。
  await page.getByTestId("tracker-review-instance-B").click();
  await setWindow(page, 10, 11);
  const accepted = page.waitForResponse(
    (response) => decisionResponse(response) && response.status() === 200,
  );
  await page.getByTestId("tracker-review-accept").click();
  await accepted;
  await expect(review).toContainText("已审 2/10");

  let rows = await annotations(request, video.task_id, token);
  const sourceA = rows.find((item) => item.id === fixture.source_annotation_ids[0]);
  const sourceB = rows.find((item) => item.id === fixture.source_annotation_ids[1]);
  expect(sourceA?.geometry.keyframes?.map((item) => item.frame_index)).toEqual([10, 11, 12]);
  expect(sourceB?.geometry.keyframes?.map((item) => item.frame_index)).toEqual([9]);

  // 部分状态可跨刷新恢复。
  await page.reload();
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review).toContainText("已审 2/10");

  // 仅拒绝 B 的 F10-F11；annotation 保持字节语义不变。
  await page.getByTestId("tracker-review-instance-A").click();
  await setWindow(page, 10, 11);
  const rejected = page.waitForResponse(
    (response) => decisionResponse(response) && response.status() === 200,
  );
  await page.getByTestId("tracker-review-discard").click();
  await rejected;
  await expect(review).toContainText("已审 4/10");
  rows = await annotations(request, video.task_id, token);
  expect(rows.find((item) => item.id === fixture.source_annotation_ids[1])
    ?.geometry.keyframes?.map((item) => item.frame_index)).toEqual([9]);

  // A/F12 是人工关键帧：第一次 409，确认后同 selector 以 override=true 成功。
  await page.getByTestId("tracker-review-instance-B").click();
  await setWindow(page, 12, 12);
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (decisionResponse(response)) statuses.push(response.status());
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("tracker-review-accept").click();
  await expect.poll(() => statuses, { timeout: 15_000 }).toEqual([409, 200]);
  await expect(review).toContainText("已审 5/10");

  rows = await annotations(request, video.task_id, token);
  const overridden = rows.find((item) => item.id === fixture.source_annotation_ids[0]);
  expect(overridden?.geometry.keyframes?.find((item) => item.frame_index === 12)?.source)
    .toBe("prediction");

  const preview = await request.get(
    `${API_BASE}/api/v1/video-tracker-jobs/${fixture.job_id}/preview`,
    { headers: auth(token) },
  );
  expect(preview.ok(), await preview.text()).toBe(true);
  expect(await preview.json()).toMatchObject({
    status: "partially_reviewed",
    candidate_pending: 5,
    candidate_accepted: 3,
    candidate_rejected: 2,
  });
});
