/**
 * v0.10.45 · AIPreAnnotateJobsPage 单测
 * 覆盖: 渲染 / 加载态 / 空态 / 有数据 / tab 切换
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── mock asyncJobsApi ────────────────────────────────────────────────────────
const mockAsyncJobsList = vi.fn();
const mockAsyncJobsCancel = vi.fn();
vi.mock("@/api/asyncJobs", () => ({
  asyncJobsApi: {
    list: (...args: unknown[]) => mockAsyncJobsList(...args),
    cancel: (...args: unknown[]) => mockAsyncJobsCancel(...args),
  },
}));

// ── mock VideoTrackerJobsPanel (it has its own useQuery) ────────────────────
vi.mock("@/pages/ModelMarket/VideoTrackerJobsPage", () => ({
  VideoTrackerJobsPanel: ({ projectId }: { projectId?: string }) => (
    <div data-testid="video-tracker-panel">video-panel{projectId ? `-${projectId}` : ""}</div>
  ),
}));

// ── mock workbench navigation utils ─────────────────────────────────────────
vi.mock("@/utils/workbenchNavigation", () => ({
  buildWorkbenchUrl: (projectId: string) => `/workbench/${projectId}`,
  currentWorkbenchReturnTo: () => "/ai-pre/jobs",
}));

import AIPreAnnotateJobsPage from "./AIPreAnnotateJobsPage";

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    kind: "batch_predict",
    project_id: "p1",
    user_id: "u1",
    project_display_id: "P-1",
    project_name: "Demo Project",
    status: "completed",
    progress_pct: 100,
    payload: {
      batch_id: "batch-abc",
      batch_display_id: "B-1",
      prompt: "car, person",
      output_mode: "det",
      total_tasks: 10,
    },
    result: { failed_count: 0, duration_ms: 5000 },
    error_message: null,
    celery_task_id: "celery-1",
    started_at: "2026-05-01T10:00:00Z",
    completed_at: "2026-05-01T10:00:05Z",
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-05-01T10:00:05Z",
    ...overrides,
  };
}

function renderUI(initialPath = "/ai-pre/jobs") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AIPreAnnotateJobsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AIPreAnnotateJobsPage", () => {
  beforeEach(() => {
    mockAsyncJobsList.mockReset();
    mockAsyncJobsCancel.mockReset();
    // 默认: 返回空列表
    mockAsyncJobsList.mockResolvedValue({ items: [], total: 0 });
    mockAsyncJobsCancel.mockResolvedValue({ status: "cancel_requested", id: "job-1" });
  });

  it("渲染页面标题与两个 tab", () => {
    renderUI();
    expect(screen.getByText("AI 任务历史")).toBeInTheDocument();
    expect(screen.getByText("图像")).toBeInTheDocument();
    expect(screen.getByText("视频")).toBeInTheDocument();
  });

  it("加载态 → 显示加载中文本", () => {
    // useQuery isLoading=true: 让 mockAsyncJobsList 挂起不 resolve
    mockAsyncJobsList.mockImplementation(() => new Promise(() => {}));
    renderUI();
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("空态 → 显示暂无历史提示", async () => {
    mockAsyncJobsList.mockResolvedValue({ items: [], total: 0 });
    renderUI();
    // 等待 query 完成
    await screen.findByText("暂无 prediction job 历史");
    expect(screen.getByText("历史 job (0)")).toBeInTheDocument();
  });

  it("有数据 → 渲染 job 行中的项目名与状态", async () => {
    mockAsyncJobsList.mockResolvedValue({ items: [makeJob()], total: 1 });
    renderUI();
    await screen.findByText("Demo Project");
    expect(screen.getByText("历史 job (1)")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(mockAsyncJobsList).toHaveBeenCalledWith(
      expect.objectContaining({ kind: ["batch_predict", "prediction_retry"] }),
    );
  });

  it("图像 tab 渲染 prediction_retry job", async () => {
    mockAsyncJobsList.mockResolvedValue({
      items: [
        makeJob({
          kind: "prediction_retry",
          status: "failed",
          payload: {
            failed_prediction_id: "fp-12345678",
            task_display_id: "TASK-9",
            error_type: "TIMEOUT",
            ml_backend_name: "bk",
          },
          result: { failed_count: 1, duration_ms: 1200 },
          error_message: "timeout",
        }),
      ],
      total: 1,
    });
    renderUI();
    await screen.findByText("TASK-9");
    expect(screen.getByText("TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("retry")).toBeInTheDocument();
  });

  it("点击「视频」tab → 渲染 VideoTrackerPanel", async () => {
    renderUI();
    fireEvent.click(screen.getByText("视频"));
    expect(await screen.findByTestId("video-tracker-panel")).toBeInTheDocument();
  });

  it("状态过滤 select → 传参给 asyncJobsApi.list", async () => {
    mockAsyncJobsList.mockResolvedValue({ items: [], total: 0 });
    renderUI();
    await screen.findByText("暂无 prediction job 历史");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "failed" } });
    // 变更后重新调用 list
    expect(mockAsyncJobsList).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("job 有 failed_count > 0 时展示 danger badge", async () => {
    mockAsyncJobsList.mockResolvedValue({
      items: [makeJob({ result: { failed_count: 3, duration_ms: 1000 } })],
      total: 1,
    });
    renderUI();
    await screen.findByText("3");
    // Badge variant=danger 渲染了 '3'
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("running batch_predict job 可触发取消", async () => {
    mockAsyncJobsList.mockResolvedValue({
      items: [makeJob({ status: "running", progress_pct: 30 })],
      total: 1,
    });
    renderUI();
    const cancelButton = await screen.findByTitle("取消 job");
    fireEvent.click(cancelButton);
    await waitFor(() => {
      expect(mockAsyncJobsCancel).toHaveBeenCalledWith("job-1");
    });
  });
});
