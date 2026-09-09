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
  read: vi.fn(),
  delete: vi.fn(),
  notifications: [] as NotificationItem[],
}));
vi.mock("@/api/tasks", () => ({ tasksApi: { get: mocks.task } }));
vi.mock("@/api/batches", () => ({ batchesApi: { get: mocks.batch } }));
vi.mock("@/api/asyncJobs", () => ({ asyncJobsApi: { get: mocks.job } }));
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
    expect(mocks.task).toHaveBeenCalledWith("t1");
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
});
