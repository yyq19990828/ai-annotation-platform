/**
 * v0.10.16 · JobsBell 单测：badge 计数 / drawer 展开 / 空态 / 状态 pill。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  beforeEach(() => {
    localStorage.clear();
    mockList.mockReset();
  });

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

  it("导出作业显示多目标格式和产物摘要", async () => {
    mockList.mockResolvedValue({
      items: [
        {
          ...baseRow,
          kind: "export",
          status: "completed" as const,
          progress_pct: 100,
          payload: { project_display_id: "P-DEMO", targets: ["coco", "yolo-det"] },
          result: {
            download_url: "https://download.example/export.zip",
            file_count: 3,
            size_bytes: 1536,
          },
        },
      ],
      total: 1,
    });
    renderBell();
    fireEvent.click(await screen.findByTestId("jobs-bell-trigger"));
    const row = await screen.findByTestId("job-row-j1");
    expect(row).toHaveTextContent("P-DEMO · COCO + YOLO DET");
    expect(row).toHaveTextContent("ZIP · 3 个文件 · 1.5 KB");
    expect(screen.getByTestId("job-download-j1")).toHaveAttribute(
      "href",
      "https://download.example/export.zip",
    );
  });

  // v0.11.17 · 筛选 + 终态 dismiss
  const mixedRows = {
    items: [
      { ...baseRow, id: "run1", status: "running" as const },
      { ...baseRow, id: "done1", status: "completed" as const, progress_pct: 100 },
      { ...baseRow, id: "fail1", status: "failed" as const, error_message: "boom" },
    ],
    total: 3,
  };

  it("进行中筛选只显示 pending/running，剔除终态", async () => {
    mockList.mockResolvedValue(mixedRows);
    renderBell();
    fireEvent.click(await screen.findByTestId("jobs-bell-trigger"));
    expect(await screen.findByTestId("job-row-done1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("jobs-bell-filter-active"));
    expect(screen.getByTestId("job-row-run1")).toBeInTheDocument();
    expect(screen.queryByTestId("job-row-done1")).toBeNull();
    expect(screen.queryByTestId("job-row-fail1")).toBeNull();
  });

  it("dismiss 一条终态任务后消失；进行中无 ✕ 且不被「清空已结束」移除", async () => {
    mockList.mockResolvedValue(mixedRows);
    renderBell();
    fireEvent.click(await screen.findByTestId("jobs-bell-trigger"));
    // 进行中无 dismiss 入口
    expect(screen.queryByTestId("job-dismiss-run1")).toBeNull();
    // 单条 dismiss completed
    fireEvent.click(await screen.findByTestId("job-dismiss-done1"));
    expect(screen.queryByTestId("job-row-done1")).toBeNull();
    // 「清空已结束」清掉剩余终态，保留进行中
    fireEvent.click(screen.getByTestId("jobs-bell-clear-terminal"));
    expect(screen.queryByTestId("job-row-fail1")).toBeNull();
    expect(screen.getByTestId("job-row-run1")).toBeInTheDocument();
    // 无可清项后按钮消失
    expect(screen.queryByTestId("jobs-bell-clear-terminal")).toBeNull();
  });

  it("filter 与 dismiss 持久化，重挂载后保留", async () => {
    mockList.mockResolvedValue(mixedRows);
    const first = renderBell();
    fireEvent.click(await screen.findByTestId("jobs-bell-trigger"));
    fireEvent.click(await screen.findByTestId("job-dismiss-done1"));
    fireEvent.click(screen.getByTestId("jobs-bell-filter-active"));
    expect(localStorage.getItem("wb:jobsbell:filter")).toBe("active");
    expect(JSON.parse(localStorage.getItem("wb:jobsbell:dismissed") ?? "[]")).toContain("done1");

    first.unmount();
    renderBell();
    fireEvent.click(await screen.findByTestId("jobs-bell-trigger"));
    expect(screen.getByTestId("jobs-bell-filter-active").getAttribute("aria-selected")).toBe(
      "true",
    );
    // 切回「全部」仍隐藏已 dismiss 的 done1
    fireEvent.click(screen.getByTestId("jobs-bell-filter-all"));
    expect(await screen.findByTestId("job-row-fail1")).toBeInTheDocument();
    expect(screen.queryByTestId("job-row-done1")).toBeNull();
  });

  it("dismiss 集合收敛：滑出窗口的 id 从 localStorage 清掉", async () => {
    localStorage.setItem("wb:jobsbell:dismissed", JSON.stringify(["done1", "slid-out-id"]));
    mockList.mockResolvedValue({
      items: [{ ...baseRow, id: "done1", status: "completed" as const, progress_pct: 100 }],
      total: 1,
    });
    renderBell();
    await screen.findByTestId("jobs-bell-trigger");
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("wb:jobsbell:dismissed") ?? "[]")).toEqual(["done1"]);
    });
  });
});
