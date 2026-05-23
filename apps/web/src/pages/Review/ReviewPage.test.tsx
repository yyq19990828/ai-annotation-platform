/**
 * ReviewPage 单测 — 加载态 / 空态 / 正常渲染 / 批次选择 / 全选交互.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseReviewerStats = vi.fn();
const mockUseTaskList = vi.fn();
const mockUseAnnotations = vi.fn();
const mockUseApproveTask = vi.fn();
const mockUseRejectTask = vi.fn();
const mockUseRejectBatch = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/hooks/useDashboard", () => ({
  useReviewerStats: () => mockUseReviewerStats(),
}));

vi.mock("@/hooks/useTasks", () => ({
  useTaskList: (...args: unknown[]) => mockUseTaskList(...args),
  useAnnotations: () => mockUseAnnotations(),
  useApproveTask: () => mockUseApproveTask(),
  useRejectTask: () => mockUseRejectTask(),
}));

vi.mock("@/hooks/useBatches", () => ({
  useRejectBatch: () => mockUseRejectBatch(),
}));

vi.mock("./ReviewSidebar", () => ({
  ReviewSidebar: ({ batches, selectedBatchId, onSelect }: any) => (
    <div data-testid="review-sidebar">
      {batches.map((b: any) => (
        <button
          key={b.batch_id}
          data-testid={`batch-${b.batch_id}`}
          onClick={() => onSelect(b)}
        >
          {b.batch_name}
        </button>
      ))}
      {selectedBatchId && (
        <button data-testid="deselect-batch" onClick={() => onSelect(null)}>
          取消选择
        </button>
      )}
    </div>
  ),
}));

vi.mock("./RejectReasonModal", () => ({
  RejectReasonModal: ({ open }: any) =>
    open ? <div data-testid="reject-modal" /> : null,
}));

vi.mock("@/components/Thumbnail", () => ({
  Thumbnail: () => <div data-testid="thumbnail" />,
}));

vi.mock("@/utils/workbenchNavigation", () => ({
  buildReviewWorkbenchUrl: (_pid: string, opts: any) =>
    `/workbench/review/${opts?.batchId ?? ""}`,
  currentWorkbenchReturnTo: () => "/review",
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { ReviewPage } from "./ReviewPage";

const idleMutation = { mutate: vi.fn(), isPending: false };

const sampleTask = {
  id: "t1",
  display_id: "T-1",
  file_name: "cat.jpg",
  thumbnail_url: null,
  blurhash: null,
  total_annotations: 3,
  total_predictions: 1,
  status: "review",
  skip_reason: null,
};

function renderUI(initialPath = "/review") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ReviewPage />
    </MemoryRouter>,
  );
}

describe("ReviewPage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockUseApproveTask.mockReturnValue(idleMutation);
    mockUseRejectTask.mockReturnValue(idleMutation);
    mockUseRejectBatch.mockReturnValue(idleMutation);
    mockUseAnnotations.mockReturnValue({ data: [] });
    mockUseReviewerStats.mockReturnValue({ data: { reviewing_batches: [] } });
    mockUseTaskList.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("初始态 → 显示侧边栏 + 「质检审核」标题 + 引导文案", () => {
    renderUI();
    expect(screen.getByTestId("review-sidebar")).toBeInTheDocument();
    expect(screen.getByText("质检审核")).toBeInTheDocument();
    expect(screen.getByText(/左侧选择批次开始审核/)).toBeInTheDocument();
  });

  it("isLoading=true → 显示「加载中...」", () => {
    mockUseTaskList.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("无任务空态 → 显示「暂无待审核任务」", () => {
    renderUI();
    expect(screen.getByText("暂无待审核任务")).toBeInTheDocument();
  });

  it("有任务 → 渲染任务行 + 全选 checkbox", () => {
    mockUseReviewerStats.mockReturnValue({
      data: {
        reviewing_batches: [
          {
            batch_id: "b1",
            batch_name: "批次A",
            batch_display_id: "B-1",
            project_id: "p1",
            project_name: "项目X",
            total_tasks: 5,
            review_tasks: 2,
            completed_tasks: 1,
          },
        ],
      },
    });
    mockUseTaskList.mockReturnValue({
      data: { pages: [{ items: [sampleTask] }] },
      isLoading: false,
    });
    renderUI("/review?project=p1&batch=b1");
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("cat.jpg")).toBeInTheDocument();
    // 批量操作栏：共 X 个待审核任务
    expect(screen.getByText(/共 1 个待审核任务/)).toBeInTheDocument();
  });

  it("全选 checkbox → 已选 N/N 文案出现 + 批量操作按钮显示", () => {
    mockUseReviewerStats.mockReturnValue({
      data: {
        reviewing_batches: [
          {
            batch_id: "b1",
            batch_name: "批次A",
            batch_display_id: "B-1",
            project_id: "p1",
            project_name: "项目X",
            total_tasks: 5,
            review_tasks: 2,
            completed_tasks: 1,
          },
        ],
      },
    });
    mockUseTaskList.mockReturnValue({
      data: { pages: [{ items: [sampleTask, { ...sampleTask, id: "t2", display_id: "T-2", file_name: "dog.jpg" }] }] },
      isLoading: false,
    });
    renderUI("/review?project=p1&batch=b1");

    // 点击全选 checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    // 第一个是全选 checkbox（bulkBar 中的）
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText(/已选 2\/2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /批量通过/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /批量退回/ })).toBeInTheDocument();
  });

  it("批量退回按钮 → 打开 RejectReasonModal", () => {
    mockUseReviewerStats.mockReturnValue({
      data: {
        reviewing_batches: [
          {
            batch_id: "b1",
            batch_name: "批次A",
            batch_display_id: "B-1",
            project_id: "p1",
            project_name: "项目X",
            total_tasks: 5,
            review_tasks: 2,
            completed_tasks: 1,
          },
        ],
      },
    });
    mockUseTaskList.mockReturnValue({
      data: { pages: [{ items: [sampleTask] }] },
      isLoading: false,
    });
    renderUI("/review?project=p1&batch=b1");

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: /批量退回/ }));
    expect(screen.getByTestId("reject-modal")).toBeInTheDocument();
  });
});
