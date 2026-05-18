/**
 * v0.10.16 · JobsBell 单测：badge 计数 / drawer 展开 / 空态 / 状态 pill。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockList = vi.fn();
vi.mock("@/api/asyncJobs", () => ({
  asyncJobsApi: { list: (params: unknown) => mockList(params) },
}));

import { JobsBell } from "./JobsBell";

function renderBell() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <JobsBell />
    </QueryClientProvider>,
  );
}

const baseRow = {
  id: "j1",
  kind: "batch_predict",
  project_id: "p1",
  user_id: "u1",
  status: "running" as const,
  progress_pct: 42,
  payload: {},
  result: {},
  error_message: null,
  celery_task_id: "c1",
  started_at: "2026-05-19T10:00:00Z",
  completed_at: null,
  created_at: "2026-05-19T09:59:00Z",
  updated_at: "2026-05-19T10:00:30Z",
};

describe("JobsBell", () => {
  it("空列表 → 不显示 badge，drawer 打开显示空态", async () => {
    mockList.mockResolvedValue({ items: [], total: 0 });
    renderBell();
    await screen.findByTestId("jobs-bell-trigger");
    expect(screen.queryByTestId("jobs-bell-badge")).toBeNull();
    fireEvent.click(screen.getByTestId("jobs-bell-trigger"));
    await screen.findByText("暂无后台任务");
  });

  it("有 running job → 显示 badge 计数 + drawer 列出 row", async () => {
    mockList.mockResolvedValue({
      items: [baseRow, { ...baseRow, id: "j2", status: "running" }],
      total: 2,
    });
    renderBell();
    const badge = await screen.findByTestId("jobs-bell-badge");
    expect(badge.textContent).toBe("2");
    fireEvent.click(screen.getByTestId("jobs-bell-trigger"));
    expect(await screen.findByTestId("job-row-j1")).toBeInTheDocument();
    expect(screen.getByTestId("job-row-j2")).toBeInTheDocument();
  });

  it("terminal jobs (completed/failed) 不计入 badge", async () => {
    mockList.mockResolvedValue({
      items: [
        { ...baseRow, status: "completed", progress_pct: 100 },
        { ...baseRow, id: "j2", status: "failed", error_message: "boom" },
      ],
      total: 2,
    });
    renderBell();
    await screen.findByTestId("jobs-bell-trigger");
    expect(screen.queryByTestId("jobs-bell-badge")).toBeNull();
  });
});
