import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { NotificationItem } from "@/api/notifications";
import { useAuthStore } from "@/stores/authStore";
import type { MeResponse } from "@/api/auth";

const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  batch: vi.fn(),
  job: vi.fn(),
  resolveDiscussion: vi.fn(),
  read: vi.fn(),
  delete: vi.fn(),
  notifications: [] as NotificationItem[],
}));
vi.mock("@/api/tasks", () => ({ tasksApi: { get: mocks.task } }));
vi.mock("@/api/batches", () => ({ batchesApi: { get: mocks.batch } }));
vi.mock("@/api/asyncJobs", () => ({ asyncJobsApi: { get: mocks.job } }));
vi.mock("@/api/discussionTargets", () => ({
  resolveActiveDiscussionAnnotation: vi.fn(),
}));
vi.mock("./NotificationsPopover.navigation", () => ({
  DiscussionNotificationError: class DiscussionNotificationError extends Error {},
  resolveDiscussionNotification: mocks.resolveDiscussion,
}));
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    data: { pages: [{ items: mocks.notifications }] },
    hasNextPage: false,
  }),
  useUnreadCount: () => ({ data: { unread: 1 } }),
  useMarkRead: () => ({ mutate: mocks.read }),
  useMarkAllRead: () => ({ mutate: vi.fn() }),
  useClearReadNotifications: () => ({ mutate: vi.fn() }),
  useDeleteNotification: () => ({ mutate: mocks.delete }),
}));
import { NotificationsPopover } from "./NotificationsPopover";

const notification: NotificationItem = {
  id: "n1",
  type: "task.rejected",
  target_type: "task",
  target_id: "t1",
  read_at: null,
  created_at: "2026-09-09T00:00:00Z",
  payload: { project_id: "old-project", task_display_id: "T-1", reject_reason: "请修正边框" },
};
const discussionIds = {
  project: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  issue: "33333333-3333-4333-8333-333333333333",
  reply: "44444444-4444-4444-8444-444444444444",
  annotation: "55555555-5555-4555-8555-555555555555",
  comment: "66666666-6666-4666-8666-666666666666",
  taskComment: "77777777-7777-4777-8777-777777777777",
};
const discussionTask = {
  id: discussionIds.task,
  project_id: discussionIds.project,
  batch_id: "batch-discussion",
};
const feedbackNotification: NotificationItem = {
  id: "n-feedback",
  type: "feedback.reply_created",
  target_type: "feedback",
  target_id: discussionIds.issue,
  read_at: null,
  created_at: "2026-09-09T00:00:00Z",
  payload: {
    project_id: discussionIds.project,
    task_id: discussionIds.task,
    source: "feedback",
    actor_name: "Bob",
    reply_id: discussionIds.reply,
  },
};
const commentNotification: NotificationItem = {
  id: "n-comment",
  type: "annotation.comment_mentioned",
  target_type: "annotation_comment",
  target_id: discussionIds.comment,
  read_at: null,
  created_at: "2026-09-09T00:00:00Z",
  payload: {
    project_id: discussionIds.project,
    task_id: discussionIds.task,
    source: "annotation_comment",
    actor_name: "Carol",
    annotation_id: discussionIds.annotation,
  },
};
const taskCommentNotification: NotificationItem = {
  id: "n-task-comment",
  type: "feedback.comment_mentioned",
  target_type: "feedback",
  target_id: discussionIds.taskComment,
  read_at: null,
  created_at: "2026-09-09T00:00:00Z",
  payload: {
    project_id: discussionIds.project,
    task_id: discussionIds.task,
    source: "feedback",
    actor_name: "Dana",
  },
};
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function renderUI() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Location />
        <NotificationsPopover />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function clickTaskNotification() {
  fireEvent.click(screen.getByTitle("通知"));
  fireEvent.click(await screen.findByRole("button", { name: "打开通知：退回了任务 T-1" }));
}

describe("通知直达当前目标", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifications = [notification];
    useAuthStore.getState().setAuth("test-token", { id: "u1", role: "annotator" } as MeResponse);
    mocks.task.mockResolvedValue({
      id: "t1",
      project_id: "p1",
      batch_id: "b1",
      status: "rejected",
      reject_reason: "最新理由",
    });
  });
  afterEach(() => {
    act(() => useAuthStore.getState().logout());
  });

  it("一次点击按服务端当前任务项目导航，包含具体任务、批次与返回入口", async () => {
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    expect(await screen.findByText('"请修正边框"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开通知：退回了任务 T-1" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/p1/annotate?batch=b1&task=t1&returnTo=%2Fdashboard",
      ),
    );
    expect(mocks.task).toHaveBeenCalledWith("t1", { signal: expect.any(AbortSignal) });
    expect(mocks.read).toHaveBeenCalledWith("n1");
  });

  it("deletes a notification without opening or marking its target read", async () => {
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    const open = await screen.findByRole("button", { name: "打开通知：退回了任务 T-1" });
    const remove = screen.getByRole("button", { name: "删除通知" });
    expect(open.contains(remove)).toBe(false);
    fireEvent.click(remove);
    expect(mocks.delete).toHaveBeenCalledWith("n1");
    expect(mocks.task).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([403, 404])("目标 %s 保留说明且不误开首条任务", async (status) => {
    mocks.task.mockRejectedValue(new ApiError(status, "gone"));
    renderUI();
    await clickTaskNotification();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "任务已被删除、转派或访问权限已变更",
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "查看当前任务" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/annotate");
  });

  it("网络失败可重试同一目标", async () => {
    mocks.task.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    renderUI();
    await clickTaskNotification();
    fireEvent.click(await screen.findByRole("button", { name: "重新打开" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("task=t1"));
    expect(mocks.task).toHaveBeenCalledTimes(2);
  });

  it("切账号后原通知的迟到响应不能改变新账号页面", async () => {
    let resolve!: (value: unknown) => void;
    mocks.task.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderUI();
    await clickTaskNotification();
    act(() =>
      useAuthStore.getState().setAuth("other-token", { id: "u2", role: "reviewer" } as MeResponse),
    );
    await act(async () => resolve({ id: "t1", project_id: "p1", batch_id: "b1" }));
    expect(screen.getByTestId("location").textContent).toBe("/dashboard");
    expect(screen.queryByText("打开通知目标")).not.toBeInTheDocument();
  });

  it("后台作业通知直接读取该次导入结果", async () => {
    mocks.notifications = [
      {
        ...notification,
        type: "job.completed",
        target_type: "async_job",
        target_id: "j1",
        payload: { kind: "dataset_import", dataset_name: "样本" },
      },
    ];
    mocks.job.mockResolvedValue({
      id: "j1",
      kind: "dataset_import",
      status: "completed",
      progress_pct: 100,
      project_id: null,
      payload: { dataset_id: "d1", dataset_name: "样本" },
      result: { imported: 3, skipped: 0, error_count: 0 },
      created_at: "2026-09-09T00:00:00Z",
      started_at: null,
      completed_at: null,
    });
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    fireEvent.click(await screen.findByRole("button", { name: "打开通知：数据集导入完成" }));
    expect(await screen.findByText("导入 3 / 跳过 0 / 错误 0")).toBeInTheDocument();
    expect(mocks.job).toHaveBeenCalledWith("j1");
    expect(screen.getByTestId("location").textContent).toBe("/dashboard");
  });

  it("问题通知核对当前任务后生成带回复定位的标注链接", async () => {
    mocks.notifications = [feedbackNotification];
    mocks.task.mockResolvedValue(discussionTask);
    mocks.resolveDiscussion.mockResolvedValue({
      projectId: discussionIds.project,
      task: discussionTask,
      kind: "feedback",
      target: { kind: "issue", issueId: discussionIds.issue, replyId: discussionIds.reply },
    });
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    fireEvent.click(await screen.findByRole("button", { name: "打开通知：回复了问题" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${discussionIds.project}/annotate?batch=batch-discussion&task=${discussionIds.task}&returnTo=%2Fdashboard&discussion=issues&issue=${discussionIds.issue}&reply=${discussionIds.reply}`,
      ),
    );
    expect(mocks.resolveDiscussion).toHaveBeenCalledWith(
      feedbackNotification,
      expect.any(AbortSignal),
    );
    expect(mocks.read).toHaveBeenCalledWith(feedbackNotification.id);
  });

  it("标注评论通知按审核角色生成评论定位链接", async () => {
    useAuthStore
      .getState()
      .setAuth("review-token", { id: "reviewer-1", role: "reviewer" } as MeResponse);
    mocks.notifications = [commentNotification];
    mocks.resolveDiscussion.mockResolvedValue({
      projectId: discussionIds.project,
      task: discussionTask,
      kind: "annotation_comment",
      target: {
        kind: "comment",
        annotationId: discussionIds.annotation,
        commentId: discussionIds.comment,
      },
    });
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    fireEvent.click(await screen.findByRole("button", { name: "打开通知：在标注评论中提到了你" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${discussionIds.project}/review?batch=batch-discussion&task=${discussionIds.task}&returnTo=%2Fdashboard&discussion=comments&focus=${discussionIds.annotation}&comment=${discussionIds.comment}`,
      ),
    );
  });

  it("任务留言提及通知生成任务留言定位链接而不打开 Issue", async () => {
    mocks.notifications = [taskCommentNotification];
    mocks.resolveDiscussion.mockResolvedValue({
      projectId: discussionIds.project,
      task: discussionTask,
      kind: "feedback",
      target: { kind: "task_comment", commentId: discussionIds.taskComment },
    });
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    fireEvent.click(await screen.findByRole("button", { name: "打开通知：在任务留言中提到了你" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${discussionIds.project}/annotate?batch=batch-discussion&task=${discussionIds.task}&returnTo=%2Fdashboard&discussion=comments&task_comment=${discussionIds.taskComment}`,
      ),
    );
    expect(mocks.read).toHaveBeenCalledWith(taskCommentNotification.id);
  });

  it("新的讨论通知点击会中止较早的查找请求", async () => {
    let firstSignal!: AbortSignal;
    let finishFirst!: () => void;
    mocks.notifications = [feedbackNotification, commentNotification];
    mocks.resolveDiscussion.mockImplementation((item: NotificationItem, signal: AbortSignal) => {
      if (item.id === feedbackNotification.id) {
        firstSignal = signal;
        return new Promise((resolve) => {
          finishFirst = () => resolve(null);
        });
      }
      return Promise.resolve({
        projectId: discussionIds.project,
        task: discussionTask,
        kind: "annotation_comment",
        target: {
          kind: "comment",
          annotationId: discussionIds.annotation,
          commentId: discussionIds.comment,
        },
      });
    });
    renderUI();
    fireEvent.click(screen.getByTitle("通知"));
    fireEvent.click(await screen.findByRole("button", { name: "打开通知：回复了问题" }));
    expect(await screen.findByRole("status")).toHaveTextContent("正在核对任务和访问权限");

    fireEvent.click(screen.getByTitle("通知"));
    fireEvent.click(await screen.findByRole("button", { name: "打开通知：在标注评论中提到了你" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${discussionIds.project}/annotate?batch=batch-discussion&task=${discussionIds.task}&returnTo=%2Fdashboard&discussion=comments&focus=${discussionIds.annotation}&comment=${discussionIds.comment}`,
      ),
    );
    expect(firstSignal.aborted).toBe(true);
    finishFirst();
  });
});
