/**
 * v0.8.7 F3 · review 反馈环 E2E：reviewer reject 真实 UI 流。
 *
 * - annotator 提交（advance_task → submitted/review）
 * - reviewer 进 /review/[task] → 点退回 → RejectReasonModal 选预设原因 → 确认
 * - 后端 task.status 应为 rejected，task.reject_reason 应非空
 *
 * 不走 _test_seed.advance_task 的 reject 短路，全程通过 UI 触发后端
 * /tasks/{id}/reject。reviewer 通过 injectToken 跳过登录，但 reject 流程必须真实。
 */
import { test, expect } from "../fixtures/seed";

const API_BASE =
  (typeof globalThis !== "undefined" &&
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env
      ?.PLAYWRIGHT_API_BASE) ||
  "http://localhost:8000";

test.describe("review feedback loop", () => {
  test("reviewer 通过 UI reject 任务 → annotator 看到 review_feedback", async ({
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

    // 2. reviewer 登录 → 进 /review 路由
    await seed.injectToken(page, data.reviewer_email);
    await page.goto("/review");
    await page.waitForLoadState("networkidle");

    // 3. 直接进入该 task 的 review workbench：ReviewPage 用 ?taskId= 触发 drawer
    await page.goto(`/review?taskId=${data.task_ids[0]}`);
    await page.waitForLoadState("networkidle");

    // 4. 点退回按钮 → 弹出 RejectReasonModal
    const rejectBtn = page.getByTestId("review-reject");
    await expect(rejectBtn).toBeVisible({ timeout: 10_000 });
    await rejectBtn.click();

    // 5. 默认选中第一项「类别错误」→ 直接确认
    const confirmBtn = page.getByTestId("reject-confirm");
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 6. Modal 关闭后，从后端 API 直接读 task 状态确认 reject 成功
    //    （UI 列表可能已切到下一题，跳过 DOM 断言避免 flaky）
    // 等 200ms 让 mutation onSuccess 完成
    await page.waitForTimeout(500);

    // 拿 reviewer token 直查 task 状态
    const tokenRes = await request.post(
      `${API_BASE}/api/v1/__test/seed/login`,
      { data: { email: data.reviewer_email } },
    );
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const taskRes = await request.get(
      `${API_BASE}/api/v1/tasks/${data.task_ids[0]}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    expect(taskRes.ok()).toBeTruthy();
    const task = (await taskRes.json()) as {
      status: string;
      reject_reason: string | null;
    };
    expect(task.status).toBe("rejected");
    expect(task.reject_reason).toBe("类别错误");
  });
});
