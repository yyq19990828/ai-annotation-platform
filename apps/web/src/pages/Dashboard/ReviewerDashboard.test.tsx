/**
 * v0.8.5 · ReviewerDashboard 单测：加载态 / 空 pending / handleApprove / handleReject
 * （含 prompt 退回原因）/ recentReviews 渲染。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseReviewerStats = vi.fn();
const mockUseMyRecentReviews = vi.fn();
const mockApproveMutate = vi.fn();
const mockRejectMutate = vi.fn();
const mockInvalidate = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/hooks/useDashboard", () => ({
  useReviewerStats: () => mockUseReviewerStats(),
  useMyRecentReviews: () => mockUseMyRecentReviews(),
}));
vi.mock("@/hooks/useTasks", () => ({
  useApproveTask: () => ({ mutate: mockApproveMutate }),
  useRejectTask: () => ({ mutate: mockRejectMutate }),
}));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  };
});
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { ReviewerDashboard } from "./ReviewerDashboard";

const baseStats = {
  pending_review_count: 3,
  today_reviewed: 5,
  approval_rate: 88,
  approval_rate_24h: 91,
  total_reviewed: 220,
  pending_tasks: [],
  reviewing_batches: [],
  median_review_duration_ms: 30000,
  reopen_after_approve_rate: 1.2,
  weekly_compare_pct: 4.5,
  daily_review_counts: [3, 4, 5, 6, 7, 5, 8],
};

function renderUI() {
  return render(
    <MemoryRouter>
      <ReviewerDashboard />
    </MemoryRouter>,
  );
}

describe("ReviewerDashboard", () => {
  beforeEach(() => {
    mockApproveMutate.mockReset();
    mockRejectMutate.mockReset();
    mockInvalidate.mockReset();
    mockPushToast.mockReset();
    mockUseMyRecentReviews.mockReturnValue({ data: [] });
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseReviewerStats.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("空 pending → 显示「暂无待审核任务」", () => {
    mockUseReviewerStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.getByText("暂无待审核任务")).toBeInTheDocument();
    expect(screen.getByText("所有标注任务已审核完毕")).toBeInTheDocument();
  });

  it("产能/质量数值正确显示", () => {
    mockUseReviewerStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.getByText("3")).toBeInTheDocument(); // pending_review_count
    expect(screen.getByText("88%")).toBeInTheDocument(); // approval_rate
    expect(screen.getByText("91%")).toBeInTheDocument(); // approval_rate_24h
    expect(screen.getByText("220")).toBeInTheDocument(); // total_reviewed
  });

  it("median_review_duration_ms < 60s → 显示 X.Xs；>= 60s → Xm", () => {
    let s = { ...baseStats, median_review_duration_ms: 45000 };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    const { unmount } = renderUI();
    expect(screen.getByText("45.0s")).toBeInTheDocument();
    unmount();

    s = { ...baseStats, median_review_duration_ms: 120000 };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    renderUI();
    expect(screen.getByText("2m")).toBeInTheDocument();
  });

  it("median_review_duration_ms=null → —", () => {
    const s = { ...baseStats, median_review_duration_ms: null };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    renderUI();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("有 pending_tasks → 渲染行 + 通过按钮触发 approveMut", () => {
    const s = {
      ...baseStats,
      pending_tasks: [
        {
          task_id: "t1",
          task_display_id: "T-1",
          file_name: "a.jpg",
          project_id: "p1",
          project_name: "Proj",
          total_annotations: 3,
          total_predictions: 1,
          updated_at: "2026-01-01T10:00:00Z",
        },
      ],
    };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    mockApproveMutate.mockImplementation((_id, opts) => opts?.onSuccess?.());
    renderUI();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("通过"));
    expect(mockApproveMutate).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockPushToast).toHaveBeenCalledWith({
      msg: "任务已通过审核",
      kind: "success",
    });
    expect(mockInvalidate).toHaveBeenCalledWith({
      queryKey: ["dashboard", "reviewer"],
    });
  });

  it("退回按钮 prompt 取消 → 不调用 rejectMut", () => {
    const s = {
      ...baseStats,
      pending_tasks: [
        {
          task_id: "t2",
          task_display_id: "T-2",
          file_name: "b.jpg",
          project_id: "p1",
          project_name: "Proj",
          total_annotations: 1,
          total_predictions: 0,
          updated_at: null,
        },
      ],
    };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    renderUI();
    fireEvent.click(screen.getByText("退回"));
    expect(promptSpy).toHaveBeenCalled();
    expect(mockRejectMutate).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("退回按钮 prompt 输入空白 → 不调用 rejectMut", () => {
    const s = {
      ...baseStats,
      pending_tasks: [
        {
          task_id: "t3",
          task_display_id: "T-3",
          file_name: "c.jpg",
          project_id: "p1",
          project_name: "Proj",
          total_annotations: 1,
          total_predictions: 0,
          updated_at: null,
        },
      ],
    };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("   ");
    renderUI();
    fireEvent.click(screen.getByText("退回"));
    expect(mockRejectMutate).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("退回按钮 prompt 有效 → 调用 rejectMut + toast + invalidate", () => {
    const s = {
      ...baseStats,
      pending_tasks: [
        {
          task_id: "t4",
          task_display_id: "T-4",
          file_name: "d.jpg",
          project_id: "p1",
          project_name: "Proj",
          total_annotations: 2,
          total_predictions: 1,
          updated_at: null,
        },
      ],
    };
    mockUseReviewerStats.mockReturnValue({ data: s, isLoading: false });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("  框位置不对  ");
    mockRejectMutate.mockImplementation((_args, opts) => opts?.onSuccess?.());
    renderUI();
    fireEvent.click(screen.getByText("退回"));
    expect(mockRejectMutate).toHaveBeenCalledWith(
      { taskId: "t4", reason: "框位置不对" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockPushToast).toHaveBeenCalledWith({
      msg: "任务已退回标注员",
      kind: "success",
    });
    promptSpy.mockRestore();
  });

  it("recentReviews 列表渲染 + 空态", () => {
    mockUseReviewerStats.mockReturnValue({ data: baseStats, isLoading: false });
    mockUseMyRecentReviews.mockReturnValue({
      data: [
        {
          task_id: "r1",
          task_display_id: "R-1",
          file_name: "x.jpg",
          project_id: "p1",
          project_name: "Proj",
          status: "completed",
          reviewed_at: "2026-01-02T08:00:00Z",
        },
      ],
    });
    renderUI();
    expect(screen.getByText("R-1")).toBeInTheDocument();
    expect(screen.getByText("已通过")).toBeInTheDocument();
  });
});
