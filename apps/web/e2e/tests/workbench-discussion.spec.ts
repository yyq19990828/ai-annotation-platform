import type { APIResponse, Page } from "@playwright/test";
import { expect, test, type SeedAPI } from "../fixtures/seed";
import { layoutCommand } from "../helpers/workbench-layout";
import { discussionTargetKey } from "../../src/pages/Workbench/state/discussionTypes";
import type {
  AnnotationFeedback,
  AnnotationFeedbackThreadPage,
  CreateFeedbackPayload,
} from "../../src/api/feedbacks";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
const discussion = (page: Page) => page.locator('[data-workbench-panel="discussion"]');
const editor = (page: Page) => discussion(page).getByRole("textbox", { name: "留言" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createIssue(
  page: Page,
  data: { project_id: string; token: string },
  taskId: string,
  title: string,
  extra: Partial<CreateFeedbackPayload> = {},
) {
  return json<AnnotationFeedback>(
    await page.request.post(`${API_BASE}/api/v1/feedbacks`, {
      headers: auth(data.token),
      data: {
        project_id: data.project_id,
        task_id: taskId,
        kind: "issue",
        anchor_type: "task",
        title,
        body: `${title}：请确认标注结果`,
        ...extra,
      },
    }),
  );
}

async function replyToIssue(page: Page, token: string, rootId: string, body: string) {
  return json<AnnotationFeedback>(
    await page.request.post(`${API_BASE}/api/v1/feedbacks/${rootId}/replies`, {
      headers: auth(token),
      data: { body },
    }),
  );
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}

async function setup(page: Page, seed: SeedAPI) {
  const data = await seed.reset();
  const token = await seed.accessToken(data.admin_email);
  await json(
    await page.request.patch(`${API_BASE}/api/v1/projects/${data.project_id}`, {
      headers: auth(token),
      data: { ai_enabled: false, ai_interactive_enabled: false, ml_backend_id: null },
    }),
  );
  expect(
    (
      await page.request.delete(
        `${API_BASE}/api/v1/projects/${data.project_id}/ml-backends/${data.ml_backend_id}`,
        { headers: auth(token) },
      )
    ).status(),
  ).toBe(204);
  await seed.injectToken(page, data.admin_email);
  return { ...data, token };
}

async function openTask(page: Page, projectId: string, taskId: string) {
  await page.goto(`/projects/${projectId}/annotate?task=${taskId}`);
  await expect(page.getByTestId("workbench-stage")).toHaveAttribute("data-image-ready", "true", {
    timeout: 20_000,
  });
  await layoutCommand(page, "标准标注布局");
  await discussion(page).getByRole("tab", { name: "评论", exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("未选标注可发送任务留言，失败保留正文，读回原生任务来源", async ({ page, seed }) => {
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openTask(page, data.project_id, taskId);
    await expect(discussion(page).getByRole("combobox", { name: "评论阅读范围" })).toHaveValue(
      "all",
    );
    await expect(discussion(page).getByRole("button", { name: "在题图上绘制" })).toHaveCount(0);
    let attempts = 0;
    await page.route("**/api/v1/feedbacks", async (route) => {
      if (route.request().method() === "POST" && attempts++ === 0) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"detail":"test retry"}',
        });
      } else await route.continue();
    });
    const body = "无需选框的任务留言";
    await editor(page).fill(body);
    await discussion(page).getByRole("button", { name: "发送", exact: true }).click();
    await expect(discussion(page).getByRole("alert")).toBeVisible();
    await expect(editor(page)).toHaveText(body);
    await discussion(page).getByRole("button", { name: "重试", exact: true }).click();
    const row = discussion(page).getByTestId("discussion-comment-row").filter({ hasText: body });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("discussion-source-chip")).toHaveText("任务留言");
    await expect(editor(page)).toBeEmpty();
    const stored = await json<{
      items: Array<{
        source: string;
        data: { body: string; task_id: string; thread_parent_id: string | null };
      }>;
    }>(
      await page.request.get(`${API_BASE}/api/v1/tasks/${taskId}/discussion/page?scope=task`, {
        headers: auth(data.token),
      }),
    );
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]).toMatchObject({
      source: "feedback",
      data: { body, task_id: taskId, thread_parent_id: null },
    });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await seed.reset();
  }
});

test("混合讨论可加载旧标注评论，阅读范围与各发送目标的草稿独立", async ({ page, seed }) => {
  test.setTimeout(120_000);
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  try {
    const annotation = await seed.createTaskAnnotation(taskId, data.admin_email, {
      annotation_type: "bbox",
      tool_unit_id: "bbox",
      class_name: "car",
      geometry: { type: "bbox", x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
    });
    const oldBody = "来自真实标注的旧批注";
    const attachmentBody = "原标注附件，不依赖当前选中对象";
    const upload = await json<{ storage_key: string; upload_url: string }>(
      await page.request.post(
        `${API_BASE}/api/v1/annotations/${annotation.id}/comment-attachments/upload-init`,
        {
          headers: auth(data.token),
          data: { file_name: "discussion-proof.txt", content_type: "text/plain" },
        },
      ),
    );
    const uploaded = await page.request.put(upload.upload_url, {
      data: Buffer.from(attachmentBody),
      headers: { "Content-Type": "text/plain" },
    });
    expect(uploaded.ok()).toBe(true);
    await json(
      await page.request.post(`${API_BASE}/api/v1/annotations/${annotation.id}/comments`, {
        headers: auth(data.token),
        data: {
          body: oldBody,
          mentions: [],
          attachments: [
            {
              storageKey: upload.storage_key,
              fileName: "discussion-proof.txt",
              mimeType: "text/plain",
              size: Buffer.byteLength(attachmentBody),
            },
          ],
          canvas_drawing: { shapes: [{ type: "line", points: [0.1, 0.1, 0.4, 0.4] }] },
        },
      }),
    );
    for (let index = 0; index < 51; index++) {
      await json(
        await page.request.post(`${API_BASE}/api/v1/feedbacks`, {
          headers: auth(data.token),
          data: {
            project_id: data.project_id,
            task_id: taskId,
            kind: "comment",
            anchor_type: "task",
            body: `分页任务留言 ${index}`,
          },
        }),
      );
    }
    await openTask(page, data.project_id, taskId);
    const panel = discussion(page);
    await expect(panel.getByTestId("discussion-comment-row")).toHaveCount(50);
    await expect(panel.getByText(oldBody, { exact: true })).toHaveCount(0);
    await panel.getByTestId("comments-load-more").click();
    const oldRow = panel.getByTestId("discussion-comment-row").filter({ hasText: oldBody });
    await expect(oldRow).toBeVisible();
    await expect(oldRow.getByTestId("discussion-source-chip")).toHaveText("标注评论");
    const downloadEvent = page.waitForEvent("download");
    await oldRow.getByRole("button", { name: "下载附件 discussion-proof.txt" }).click();
    const download = await downloadEvent;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toBe("discussion-proof.txt");
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe(attachmentBody);
    await oldRow.getByTestId("comment-annotation-chip").click();
    const scope = panel.getByRole("combobox", { name: "评论阅读范围" });
    await expect(scope).toHaveValue("all");
    await editor(page).fill("任务草稿保留");
    const destination = panel.getByRole("combobox", { name: "发送目标" });
    await destination.selectOption(
      discussionTargetKey({
        projectId: data.project_id,
        taskId,
        kind: "annotation",
        annotationId: annotation.id,
      }),
    );
    await expect(editor(page)).toBeEmpty();
    await editor(page).fill("标注草稿保留");
    await scope.selectOption("annotation");
    await expect(editor(page)).toHaveText("标注草稿保留");
    await scope.selectOption("task");
    await expect(editor(page)).toHaveText("标注草稿保留");
    await destination.selectOption(
      discussionTargetKey({ projectId: data.project_id, taskId, kind: "task" }),
    );
    await expect(editor(page)).toHaveText("任务草稿保留");
    await expect(panel.getByTestId("comment-input-disabled")).toHaveCount(0);
  } finally {
    await page.close();
    await seed.reset();
  }
});

test("任务 A 的晚响应不清空任务 B 草稿，离开工作台再返回仍保留当前草稿", async ({ page, seed }) => {
  test.setTimeout(90_000);
  const data = await setup(page, seed);
  const [taskA, taskB] = data.task_ids;
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let committed = false;
  try {
    const taskLabels = await Promise.all(
      [taskA, taskB].map(async (id) =>
        json<{ display_id: string }>(
          await page.request.get(`${API_BASE}/api/v1/tasks/${id}`, { headers: auth(data.token) }),
        ),
      ),
    );
    await page.route("**/api/v1/feedbacks", async (route) => {
      if (route.request().method() !== "POST" || route.request().postDataJSON().task_id !== taskA) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await responseGate;
      await route.fulfill({ response });
    });
    await openTask(page, data.project_id, taskA);
    await editor(page).fill("任务 A 已发送内容");
    await discussion(page).getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => committed).toBe(true);
    const queue = page.getByRole("tabpanel", { name: "任务队列", exact: true });
    await queue.getByText(taskLabels[1].display_id, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${taskB}`));
    await expect(editor(page)).toBeEditable();
    await editor(page).fill("任务 B 未发送草稿");
    releaseResponse();
    await expect(discussion(page).getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await expect(editor(page)).toHaveText("任务 B 未发送草稿");
    await queue.getByText(taskLabels[0].display_id, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${taskA}`));
    await expect(editor(page)).toBeEmpty();
    await editor(page).fill("离开工作台仍保留的草稿");
    await page
      .getByTestId("workbench-topbar")
      .getByRole("button", { name: "返回", exact: true })
      .click();
    await expect(page.getByTestId("workbench-topbar")).toHaveCount(0);
    await page.goBack();
    await expect(editor(page)).toHaveText("离开工作台仍保留的草稿");
  } finally {
    releaseResponse();
    await page.close();
    await seed.reset();
  }
});

test("弹窗未保存笔触跨页签和工作台路由恢复，并提交到原标注", async ({ page, seed }) => {
  test.setTimeout(90_000);
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const annotation = await seed.createTaskAnnotation(taskId, data.admin_email, {
      annotation_type: "bbox",
      tool_unit_id: "bbox",
      class_name: "car",
      geometry: { type: "bbox", x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
    });
    await openTask(page, data.project_id, taskId);
    await page.getByTestId(`box-list-item-${annotation.id}`).click();
    await discussion(page)
      .getByRole("combobox", { name: "发送目标" })
      .selectOption(
        discussionTargetKey({
          projectId: data.project_id,
          taskId,
          kind: "annotation",
          annotationId: annotation.id,
        }),
      );
    const popupButton = discussion(page).getByTitle("弹窗内绘制（与原图比例对齐）");
    await popupButton.click();
    const popup = page.getByRole("dialog", { name: "画布批注", exact: true });
    await expect(popup).toBeVisible();
    const drawing = popup.locator('svg[viewBox="0 0 1 1"]');
    const bounds = (await drawing.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.65, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(drawing.locator("polyline")).toHaveCount(1);
    const points = await drawing.locator("polyline").getAttribute("points");
    // Closing the modal is not the explicit Save action: its unfinished
    // composer draft must already own this stroke before presentation unmounts.
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await discussion(page).getByRole("tab", { name: "历史", exact: true }).click();
    await discussion(page).getByRole("tab", { name: "评论", exact: true }).click();
    await expect(popupButton).toContainText("1 条");
    await page
      .getByTestId("workbench-topbar")
      .getByRole("button", { name: "返回", exact: true })
      .click();
    await expect(page.getByTestId("workbench-topbar")).toHaveCount(0);
    await page.goBack();
    await expect(popupButton).toContainText("1 条");
    await popupButton.click();
    await expect(drawing.locator("polyline")).toHaveCount(1);
    await expect(drawing.locator("polyline")).toHaveAttribute("points", points!);
    await popup.getByRole("button", { name: "保存批注", exact: true }).click();
    await editor(page).fill("关闭弹窗和离开工作台都未丢失的绘图");
    await discussion(page).getByRole("button", { name: "发送", exact: true }).click();
    const row = discussion(page).getByTestId("discussion-comment-row").filter({
      hasText: "关闭弹窗和离开工作台都未丢失的绘图",
    });
    await expect(row).toBeVisible();
    const stored = await json<{
      items: Array<{
        data: { annotation_id: string; canvas_drawing: { shapes: Array<{ points: number[] }> } };
      }>;
    }>(
      await page.request.get(`${API_BASE}/api/v1/tasks/${taskId}/discussion/page`, {
        headers: auth(data.token),
      }),
    );
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].data.annotation_id).toBe(annotation.id);
    expect(stored.items[0].data.canvas_drawing.shapes).toHaveLength(1);
    expect(stored.items[0].data.canvas_drawing.shapes[0].points).toEqual(
      points!.split(/[ ,]/).map(Number),
    );
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await seed.reset();
  }
});

test("任务问题完整读取旧回复和嵌套回复，失败重试后解决仍保留详情", async ({ page, seed }) => {
  test.setTimeout(150_000);
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const root = await createIssue(page, data, taskId, "检查遮挡边缘");
    const first = await replyToIssue(page, data.token, root.id, "最早的复核意见");
    const child = await replyToIssue(page, data.token, first.id, "历史嵌套回复仍属于原问题");
    for (let index = 0; index < 51; index++) {
      await replyToIssue(page, data.token, root.id, `后续复核记录 ${index}`);
    }
    await openTask(page, data.project_id, taskId);
    const panel = discussion(page);
    await panel.getByRole("tab", { name: /^问题/ }).click();
    await page.getByTestId(`discussion-issue-open-${root.id}`).click();
    const detail = page.getByTestId("discussion-issue-detail");
    await expect(detail).toHaveAttribute("data-issue-id", root.id);
    await expect(detail).toContainText(root.body);
    await expect(detail.getByTestId(`discussion-issue-locate-${root.id}`)).toHaveCount(0);
    await expect(detail.locator('[data-testid^="discussion-issue-reply-"]')).toHaveCount(50);
    await expect(detail.getByText(first.body, { exact: true })).toHaveCount(0);
    let earlierAttempts = 0;
    await page.route(`**/api/v1/feedbacks/${root.id}/thread?*`, async (route) => {
      if (new URL(route.request().url()).searchParams.has("cursor") && earlierAttempts++ === 0) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"detail":"test earlier replies retry"}',
        });
      } else await route.continue();
    });
    await detail.getByRole("button", { name: "加载更早回复", exact: true }).click();
    const rows = detail.locator('[data-testid^="discussion-issue-reply-"]');
    const threadError = detail.getByTestId("discussion-issue-thread-error");
    await expect(threadError).toBeVisible();
    await expect(rows).toHaveCount(50);
    await expect(detail).toContainText(root.body);
    await threadError.getByRole("button", { name: "重试", exact: true }).click();
    await expect(rows).toHaveCount(53);
    await expect(threadError).toHaveCount(0);
    expect(earlierAttempts).toBe(2);
    await expect(rows.first()).toContainText(first.body);
    await expect(rows.nth(1)).toContainText(child.body);
    await expect(detail.getByRole("button", { name: "加载更早回复", exact: true })).toHaveCount(0);

    let replyAttempts = 0;
    await page.route(`**/api/v1/feedbacks/${root.id}/replies`, async (route) => {
      if (route.request().method() === "POST" && replyAttempts++ === 0) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"detail":"test reply retry"}',
        });
      } else await route.continue();
    });
    const replyBody = "已修正遮挡边缘，请再次确认";
    const replyEditor = detail.getByRole("textbox", { name: "留言" });
    await replyEditor.fill(replyBody);
    await detail.getByRole("button", { name: "发送", exact: true }).click();
    await expect(detail.getByRole("alert")).toBeVisible();
    await expect(replyEditor).toHaveText(replyBody);
    await detail.getByRole("button", { name: "重试", exact: true }).click();
    await expect(detail.getByText(replyBody, { exact: true })).toBeVisible();
    await expect(replyEditor).toBeEmpty();
    expect(replyAttempts).toBe(2);
    const readback = await json<AnnotationFeedbackThreadPage>(
      await page.request.get(`${API_BASE}/api/v1/feedbacks/${root.id}/thread?limit=200`, {
        headers: auth(data.token),
      }),
    );
    expect(readback.total).toBe(54);
    expect(readback.items.filter((item) => item.body === replyBody)).toHaveLength(1);
    expect(readback.items.find((item) => item.body === replyBody)?.thread_parent_id).toBe(root.id);

    await detail.getByRole("button", { name: "解决", exact: true }).click();
    await expect(detail).toHaveAttribute("data-issue-id", root.id);
    await expect(detail.getByRole("button", { name: "重新打开", exact: true })).toBeVisible();
    const resolved = await json<AnnotationFeedbackThreadPage>(
      await page.request.get(`${API_BASE}/api/v1/feedbacks/${root.id}/thread`, {
        headers: auth(data.token),
      }),
    );
    expect(resolved.root.status).toBe("resolved");
    await detail.getByRole("button", { name: "返回问题列表", exact: true }).click();
    await expect(panel.getByTestId(`discussion-issue-card-${root.id}`)).toHaveCount(0);
    await expect(panel.getByTestId("issue-open-count")).toHaveText("待处理 0");
    await panel.getByTestId("issue-status-resolved").click();
    await panel.getByTestId(`discussion-issue-open-${root.id}`).click();
    await detail.getByRole("button", { name: "重新打开", exact: true }).click();
    await expect(detail.getByRole("button", { name: "解决", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await seed.reset();
  }
});

test("未加载且被筛掉的图钉直接打开详情，不改列表筛选", async ({ page, seed }) => {
  test.setTimeout(150_000);
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  try {
    const oldRoot = await createIssue(page, data, taskId, "较早的边缘问题", {
      anchor_type: "pixel",
      anchor_position: { x: 0.3, y: 0.4 },
    });
    await json(
      await page.request.patch(`${API_BASE}/api/v1/feedbacks/${oldRoot.id}`, {
        headers: auth(data.token),
        data: { status: "resolved" },
      }),
    );
    for (let index = 0; index < 51; index++) {
      await createIssue(page, data, taskId, `其他待处理问题 ${index}`);
    }
    await openTask(page, data.project_id, taskId);
    const panel = discussion(page);
    await panel.getByRole("tab", { name: /^问题/ }).click();
    await expect(panel.getByTestId("issue-open-count")).toHaveText("待处理 51");
    await expect(panel.getByTestId(`discussion-issue-card-${oldRoot.id}`)).toHaveCount(0);
    await expect(page.getByTestId("issue-pin-coverage")).toHaveCount(0);
    const stage = page.getByTestId("workbench-stage");
    const bounds = await stage.boundingBox();
    expect(bounds).not.toBeNull();
    const point = await stage.evaluate((element) => ({
      x:
        Number(element.getAttribute("data-media-x")) +
        Number(element.getAttribute("data-media-width")) * 0.3,
      y:
        Number(element.getAttribute("data-media-y")) +
        Number(element.getAttribute("data-media-height")) * 0.4,
    }));
    await page.mouse.click(bounds!.x + point.x, bounds!.y + point.y);
    const detail = page.getByTestId("discussion-issue-detail");
    await expect(detail).toHaveAttribute("data-issue-id", oldRoot.id);
    await expect(detail).toContainText(oldRoot.body);
    await expect(detail.getByRole("button", { name: "重新打开", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "返回问题列表", exact: true }).click();
    await expect(panel.getByTestId("issue-status-open")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId(`discussion-issue-card-${oldRoot.id}`)).toHaveCount(0);
    await expect(panel.getByTestId("issue-open-count")).toHaveText("待处理 51");
  } finally {
    await page.close();
    await seed.reset();
  }
});

test("解决分页边界上的问题后继续下一条，返回列表保留阅读位置", async ({ page, seed }) => {
  test.setTimeout(150_000);
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  try {
    const roots: AnnotationFeedback[] = [];
    for (let index = 0; index < 52; index++) {
      roots.push(await createIssue(page, data, taskId, `顺序复核 ${index}`));
    }
    await openTask(page, data.project_id, taskId);
    const panel = discussion(page);
    await panel.getByRole("tab", { name: /^问题/ }).click();
    await expect(panel.locator('[data-testid^="discussion-issue-card-"]')).toHaveCount(50);
    const current = roots[2]; // The fiftieth item of the descending first page.
    const next = roots[1];
    const last = roots[0];
    const openCurrent = panel.getByTestId(`discussion-issue-open-${current.id}`);
    await openCurrent.scrollIntoViewIfNeeded();
    const list = panel.getByTestId("discussion-issue-list-scroll");
    const scrollTop = await list.evaluate((element) => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    await openCurrent.click();
    const detail = page.getByTestId("discussion-issue-detail");
    await expect(detail).toHaveAttribute("data-issue-id", current.id);
    await detail.getByRole("button", { name: "解决", exact: true }).click();
    await expect(detail.getByRole("button", { name: "重新打开", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "下一条", exact: true }).click();
    await expect(detail).toHaveAttribute("data-issue-id", next.id);
    await detail.getByRole("button", { name: "下一条", exact: true }).click();
    await expect(detail).toHaveAttribute("data-issue-id", last.id);
    await expect(detail.getByRole("button", { name: "下一条", exact: true })).toBeDisabled();
    await detail.getByRole("button", { name: "上一条", exact: true }).click();
    await expect(detail).toHaveAttribute("data-issue-id", next.id);
    await detail.getByRole("button", { name: "返回问题列表", exact: true }).click();
    // One resolved card was removed; the list restores the nearest available
    // scroll offset instead of resetting to the top or rewinding pagination.
    await expect
      .poll(() => list.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(scrollTop / 2);
    await expect(panel.getByTestId("issue-status-open")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("issue-open-count")).toHaveText("待处理 51");
  } finally {
    await page.close();
    await seed.reset();
  }
});

test("迟到的问题回复不清空另一问题或原问题的新草稿", async ({ page, seed }) => {
  test.setTimeout(90_000);
  const data = await setup(page, seed);
  const taskId = data.task_ids[0];
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let committed = false;
  try {
    const first = await createIssue(page, data, taskId, "问题 A");
    const second = await createIssue(page, data, taskId, "问题 B");
    await page.route(`**/api/v1/feedbacks/${first.id}/replies`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await responseGate;
      await route.fulfill({ response });
    });
    await openTask(page, data.project_id, taskId);
    const panel = discussion(page);
    await panel.getByRole("tab", { name: /^问题/ }).click();
    const detail = page.getByTestId("discussion-issue-detail");
    const input = detail.getByRole("textbox", { name: "留言" });
    const openIssue = async (id: string) => {
      await panel.getByTestId(`discussion-issue-open-${id}`).click();
      await expect(detail).toHaveAttribute("data-issue-id", id);
      await expect(input).toBeEditable();
    };
    const back = () => detail.getByRole("button", { name: "返回问题列表", exact: true }).click();
    await openIssue(first.id);
    await input.fill("问题 A 已提交的回复");
    await detail.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => committed).toBe(true);
    await back();
    await openIssue(second.id);
    await input.fill("问题 B 保留的草稿");
    await back();
    await openIssue(first.id);
    await input.fill("问题 A 后续补充的新草稿");
    releaseResponse();
    await expect(detail.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await expect(input).toHaveText("问题 A 后续补充的新草稿");
    const readback = await json<AnnotationFeedbackThreadPage>(
      await page.request.get(`${API_BASE}/api/v1/feedbacks/${first.id}/thread`, {
        headers: auth(data.token),
      }),
    );
    expect(readback.items).toHaveLength(1);
    expect(readback.items[0]).toMatchObject({
      kind: "comment",
      thread_parent_id: first.id,
      body: "问题 A 已提交的回复",
    });
    await back();
    await openIssue(second.id);
    await expect(input).toHaveText("问题 B 保留的草稿");
  } finally {
    releaseResponse();
    await page.close();
    await seed.reset();
  }
});
