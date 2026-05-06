/**
 * v0.8.5 · AnnotatorDashboard 单测：加载态 / 空项目 / hour_buckets 直方图渲染 /
 * formatMs 边界 / sortedProjects 排序。
 *
 * 用 vi.mock 拦截 hooks（useAnnotatorStats / useProjects / useMyBatches）避免
 * 引入 react-query / MSW 依赖。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseAnnotatorStats = vi.fn();
const mockUseProjects = vi.fn();
const mockUseMyBatches = vi.fn();

vi.mock("@/hooks/useDashboard", () => ({
  useAnnotatorStats: () => mockUseAnnotatorStats(),
  useMyBatches: () => mockUseMyBatches(),
}));
vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => mockUseProjects(),
}));
// MyBatchesCard 内部用 useQueryClient，避免引入 QueryClientProvider，整体 mock 掉。
vi.mock("./MyBatchesCard", () => ({
  MyBatchesCard: () => <div data-testid="my-batches-card-stub" />,
}));

import { AnnotatorDashboard } from "./AnnotatorDashboard";

const fullStats = {
  assigned_tasks: 5,
  today_completed: 3,
  weekly_completed: 18,
  total_completed: 120,
  personal_accuracy: 92.5,
  daily_counts: [1, 2, 3, 4, 5, 6, 7],
  median_duration_ms: 45000,
  rejected_rate: 2.1,
  reopened_avg: 0.3,
  weekly_compare_pct: 5.4,
  weekly_target: 200,
  active_minutes_today: 42,
  streak_days: 7,
  hour_buckets: Array(24).fill(0).map((_, h) => (h === 9 ? 5 : h === 14 ? 2 : 0)),
};

function renderUI() {
  return render(
    <MemoryRouter>
      <AnnotatorDashboard />
    </MemoryRouter>,
  );
}

describe("AnnotatorDashboard", () => {
  beforeEach(() => {
    mockUseAnnotatorStats.mockReset();
    mockUseProjects.mockReset();
    mockUseMyBatches.mockReset();
    mockUseMyBatches.mockReturnValue({ data: [], isLoading: false });
  });

  it("isLoading=true → 显示加载中文案", () => {
    mockUseAnnotatorStats.mockReturnValue({ data: undefined, isLoading: true });
    mockUseProjects.mockReturnValue({ data: [] });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("stats=null（未加载完）→ 显示加载中文案，不崩", () => {
    mockUseAnnotatorStats.mockReturnValue({ data: null, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("有 stats + 0 项目 → 显示「暂无分配项目」空态", () => {
    mockUseAnnotatorStats.mockReturnValue({ data: fullStats, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    renderUI();
    expect(screen.getByText("暂无分配项目")).toBeInTheDocument();
  });

  it("有 stats → 渲染 24-bar 直方图（hour_buckets 长度 24）", () => {
    mockUseAnnotatorStats.mockReturnValue({ data: fullStats, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    const { container } = renderUI();
    expect(screen.getByText("今日专注时段分布")).toBeInTheDocument();
    // bar 都有 borderRadius "2px 2px 0 0"
    const bars = Array.from(container.querySelectorAll("div")).filter(
      (el) => (el as HTMLElement).style.borderRadius === "2px 2px 0 0",
    );
    expect(bars.length).toBe(24);
  });

  it("hour_buckets 为 undefined → 用全 0 兜底渲染 24 bar", () => {
    const stats = { ...fullStats, hour_buckets: undefined };
    mockUseAnnotatorStats.mockReturnValue({ data: stats, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    const { container } = renderUI();
    const bars = Array.from(container.querySelectorAll("div")).filter(
      (el) => (el as HTMLElement).style.borderRadius === "2px 2px 0 0",
    );
    expect(bars.length).toBe(24);
  });

  it("产能/质量/投入卡片显示具体数值", () => {
    mockUseAnnotatorStats.mockReturnValue({ data: fullStats, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    renderUI();
    // 产能
    expect(screen.getByText("待标任务")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // 质量原创比例
    expect(screen.getByText("92.5%")).toBeInTheDocument();
    // 投入活跃时长
    expect(screen.getByText("42m")).toBeInTheDocument();
    expect(screen.getByText("7天")).toBeInTheDocument();
  });

  it("active_minutes_today=null → 显示 — 占位", () => {
    const s = { ...fullStats, active_minutes_today: null, streak_days: null };
    mockUseAnnotatorStats.mockReturnValue({ data: s, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    renderUI();
    // 至少 3 个 — 占位（活跃 / streak / rejected_rate 等可能 null 的）
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("median_duration_ms < 60s → 显示 X.Xs，>= 60s → XmYYs", () => {
    // < 60s
    let s = { ...fullStats, median_duration_ms: 45000 };
    mockUseAnnotatorStats.mockReturnValue({ data: s, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    const { unmount } = renderUI();
    expect(screen.getByText("45.0s")).toBeInTheDocument();
    unmount();

    // >= 60s
    s = { ...fullStats, median_duration_ms: 125000 };
    mockUseAnnotatorStats.mockReturnValue({ data: s, isLoading: false });
    mockUseProjects.mockReturnValue({ data: [] });
    renderUI();
    expect(screen.getByText("2m05s")).toBeInTheDocument();
  });

  it("项目按剩余任务数倒序", () => {
    const projects = [
      { id: "a", display_id: "P-A", name: "A", type_label: "图像检测", total_tasks: 10, completed_tasks: 8 }, // 剩 2
      { id: "b", display_id: "P-B", name: "B", type_label: "图像检测", total_tasks: 10, completed_tasks: 0 }, // 剩 10
      { id: "c", display_id: "P-C", name: "C", type_label: "图像检测", total_tasks: 10, completed_tasks: 5 }, // 剩 5
    ];
    mockUseAnnotatorStats.mockReturnValue({ data: fullStats, isLoading: false });
    mockUseProjects.mockReturnValue({ data: projects });
    renderUI();
    const rows = screen.getAllByText(/^[ABC]$/);
    expect(rows[0].textContent).toBe("B"); // 剩 10
    expect(rows[1].textContent).toBe("C"); // 剩 5
    expect(rows[2].textContent).toBe("A"); // 剩 2
  });
});
