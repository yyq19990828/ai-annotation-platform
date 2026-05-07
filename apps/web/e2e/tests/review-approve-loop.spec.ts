/**
 * v0.8.8 · review 通过路径 E2E：reviewer approve 真实 UI 流。
 *
 * - annotator 提交（advance_task → submitted/review）
 * - reviewer 进 /review?task={id} → 点通过按钮
 * - 后端 task.status 应为 completed
 * - annotator 视角应能从 /api/v1/notifications 取到 task.approved 事件
 *
 * 与 review-feedback-loop.spec.ts 镜像，覆盖 ROADMAP §C2 「reviewer approve →
 * annotator 通知 E2E 闭环」。
 */
import { test, expect } from "../fixtures/seed";

const API_BASE =
  (typeof globalThis !== "undefined" &&
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env
      ?.PLAYWRIGHT_API_BASE) ||
  "http://localhost:8000";

test.describe("review approve loop", () => {
  test("reviewer 通过 UI approve 任务 → annotator 通知列表出现 task.approved", async ({
    page,
    seed,
    request,
  }) => {
    const data = await seed.reset();

    // 1. 把 task[0] 推到 review 状态，并双绑定 annotator/reviewer
    await seed.advanceTask({
      taskId: data.task_ids[0],
      toStatus: "review",
      annotatorEmail: data.annotator_email,
      reviewerEmail: data.reviewer_email,
    });

    // 2. reviewer 登录 → 进 /review?task={id}
    await seed.injectToken(page, data.reviewer_email);
    await page.goto("/review");
    await page.waitForLoadState("networkidle");
    await page.goto(`/review?task=${data.task_ids[0]}`);
    await page.waitForLoadState("networkidle");

    // 3. 点通过按钮（v0.8.7 已就位 data-testid="review-approve"）
    const approveBtn = page.getByTestId("review-approve");
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();

    // mutation onSuccess 后 close drawer + invalidate task
    await page.waitForTimeout(500);

    // 4. 后端直查 task 状态确认 approve 成功（避免依赖 reviewer 列表 DOM）
    const reviewerTokenRes = await request.post(
      `${API_BASE}/api/v1/__test/seed/login`,
      { data: { email: data.reviewer_email } },
    );
    const reviewerToken = ((await reviewerTokenRes.json()) as {
      access_token: string;
    }).access_token;
    const taskRes = await request.get(
      `${API_BASE}/api/v1/tasks/${data.task_ids[0]}`,
      { headers: { Authorization: `Bearer ${reviewerToken}` } },
    );
    expect(taskRes.ok()).toBeTruthy();
    const task = (await taskRes.json()) as { status: string };
    expect(task.status).toBe("completed");

    // 5. annotator 视角：拉 /notifications 应有一条 task.approved 通知
    const annotatorTokenRes = await request.post(
      `${API_BASE}/api/v1/__test/seed/login`,
      { data: { email: data.annotator_email } },
    );
    const annotatorToken = ((await annotatorTokenRes.json()) as {
      access_token: string;
    }).access_token;
    const notiRes = await request.get(
      `${API_BASE}/api/v1/notifications?limit=20`,
      { headers: { Authorization: `Bearer ${annotatorToken}` } },
    );
    expect(notiRes.ok()).toBeTruthy();
    const noti = (await notiRes.json()) as {
      items: Array<{ type: string; data?: { task_id?: string } }>;
    };
    const approved = noti.items.find(
      (n) =>
        n.type === "task.approved" &&
        (n.data?.task_id === undefined || n.data.task_id === data.task_ids[0]),
    );
    expect(approved, "expected task.approved notification for annotator").toBeTruthy();
  });
});
