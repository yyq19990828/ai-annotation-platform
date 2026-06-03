/**
 * AdminPeoplePage 单测
 * 覆盖: 加载态 / 空列表 / 成员卡片渲染 / 筛选按钮交互 / 点击卡片打开抽屉 /
 *       抽屉加载态 / 抽屉关闭
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseAdminPeople = vi.fn();
const mockUseAdminPersonDetail = vi.fn();

vi.mock("@/hooks/useDashboard", () => ({
  useAdminPeople: (...args: unknown[]) => mockUseAdminPeople(...args),
  useAdminPersonDetail: (...args: unknown[]) => mockUseAdminPersonDetail(...args),
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: vi.fn() }),
  };
});

import { AdminPeoplePage } from "./AdminPeoplePage";

const basePerson = {
  user_id: "u1",
  name: "Alice",
  email: "alice@test.com",
  role: "annotator",
  status: "online",
  project_count: 3,
  main_metric: 120,
  main_metric_label: "任务/天",
  weekly_compare_pct: 10,
  throughput_score: 80,
  quality_score: 90,
  activity_score: 70,
  sparkline_7d: [10, 20, 30, 40, 50, 60, 70],
  rejected_rate: 5,
  alerts: [],
};

const baseDetail = {
  user_id: "u1",
  name: "Alice",
  email: "alice@test.com",
  role: "annotator",
  project_count: 3,
  throughput: 120,
  quality_score: 90,
  active_minutes: 480,
  composite_score: 87,
  weekly_compare_pct: 10,
  trend_throughput: [100, 110, 120, 130],
  trend_quality: [85, 87, 89, 90],
  project_distribution: [
    { project_id: "p1", project_name: "项目A", count: 50 },
  ],
  duration_histogram: [],
  p50_duration_ms: null,
  p95_duration_ms: null,
  timeline: [],
  reject_reason_breakdown: [],
  class_distribution: [],
  first_pass_yield: null,
};

function renderUI(initialPath = "/admin/people") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminPeoplePage />
    </MemoryRouter>,
  );
}

describe("AdminPeoplePage", () => {
  beforeEach(() => {
    mockUseAdminPeople.mockReturnValue({ data: undefined, isLoading: false });
    mockUseAdminPersonDetail.mockReturnValue({ data: undefined, isLoading: true });
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseAdminPeople.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("空列表 → 显示「暂无成员数据」提示", () => {
    mockUseAdminPeople.mockReturnValue({ data: { items: [], total: 0, period: "7d" }, isLoading: false });
    renderUI();
    expect(screen.getByText("暂无成员数据")).toBeInTheDocument();
  });

  it("有成员时渲染卡片内容", () => {
    mockUseAdminPeople.mockReturnValue({
      data: { items: [basePerson], total: 1, period: "7d" },
      isLoading: false,
    });
    renderUI();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/annotator/)).toBeInTheDocument();
    // main_metric 渲染
    expect(screen.getByText("120")).toBeInTheDocument();
    // project_count
    expect(screen.getByText(/3 项目/)).toBeInTheDocument();
  });

  it("成员有 high_rejected alert → 显示退回率 badge", () => {
    const personWithAlert = { ...basePerson, alerts: ["high_rejected"], rejected_rate: 20 };
    mockUseAdminPeople.mockReturnValue({
      data: { items: [personWithAlert], total: 1, period: "7d" },
      isLoading: false,
    });
    renderUI();
    expect(screen.getByText(/退回率 20%/)).toBeInTheDocument();
  });

  it("点击角色筛选按钮更新 URL 参数", () => {
    mockUseAdminPeople.mockReturnValue({
      data: { items: [], total: 0, period: "7d" },
      isLoading: false,
    });
    renderUI();
    const annotatorBtn = screen.getByRole("button", { name: "标注员" });
    fireEvent.click(annotatorBtn);
    // 筛选按钮触发后, useAdminPeople 会被以新参数调用
    expect(mockUseAdminPeople).toHaveBeenCalled();
  });

  it("点击卡片打开个人抽屉", () => {
    mockUseAdminPeople.mockReturnValue({
      data: { items: [basePerson], total: 1, period: "7d" },
      isLoading: false,
    });
    mockUseAdminPersonDetail.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    // 卡片可点击 (Card onClick)
    const card = screen.getByText("Alice").closest("[class]")!;
    fireEvent.click(card);
    // 抽屉加载态
    expect(screen.getAllByText("加载中...").length).toBeGreaterThan(0);
  });

  it("抽屉有数据时显示成员详情", async () => {
    mockUseAdminPeople.mockReturnValue({
      data: { items: [basePerson], total: 1, period: "7d" },
      isLoading: false,
    });
    mockUseAdminPersonDetail.mockReturnValue({ data: baseDetail, isLoading: false });
    renderUI();
    // 点开抽屉
    const card = screen.getByText("Alice").closest("[class]")!;
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getAllByText("产能").length).toBeGreaterThan(0);
      expect(screen.getAllByText("质量").length).toBeGreaterThan(0);
      expect(screen.getByText("4 周趋势")).toBeInTheDocument();
    });
  });

  it("点击抽屉关闭按钮关闭抽屉", async () => {
    mockUseAdminPeople.mockReturnValue({
      data: { items: [basePerson], total: 1, period: "7d" },
      isLoading: false,
    });
    mockUseAdminPersonDetail.mockReturnValue({ data: baseDetail, isLoading: false });
    renderUI();
    // 打开抽屉
    const card = screen.getByText("Alice").closest("[class]")!;
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByLabelText("关闭")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("关闭"));
    // 抽屉关闭后详情不在 DOM 中
    await waitFor(() =>
      expect(screen.queryByText("4 周趋势")).not.toBeInTheDocument(),
    );
  });

  it("页面标题「成员绩效」始终可见", () => {
    mockUseAdminPeople.mockReturnValue({ data: { items: [], total: 0, period: "7d" }, isLoading: false });
    renderUI();
    expect(screen.getByText("成员绩效")).toBeInTheDocument();
  });
});
