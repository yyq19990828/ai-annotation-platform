/**
 * v0.8.5 · AdminDashboard 单测：加载态 / 主要卡片 / 状态分布 / role_distribution /
 * ML backend 0/n 分支 / 注册来源空 vs 有数据 / 项目列表空态 / wizard 入口 toggle。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseAdminStats = vi.fn();
const mockUseProjects = vi.fn();
const mockUseAuditLogs = vi.fn();

vi.mock("@/hooks/useDashboard", () => ({
  useAdminStats: () => mockUseAdminStats(),
}));
vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => mockUseProjects(),
}));
vi.mock("@/hooks/useAudit", () => ({
  useAuditLogs: () => mockUseAuditLogs(),
}));
// 重 wizard 子组件 stub（避免它们的 react-query / form 复杂度）
vi.mock("@/components/projects/CreateProjectWizard", () => ({
  CreateProjectWizard: ({ open }: any) => (open ? <div data-testid="cp-wizard" /> : null),
}));
vi.mock("@/components/datasets/ImportDatasetWizard", () => ({
  ImportDatasetWizard: ({ open }: any) => (open ? <div data-testid="id-wizard" /> : null),
}));

import { AdminDashboard } from "./AdminDashboard";

const baseStats = {
  total_users: 25,
  active_users: 8,
  total_projects: 10,
  projects_in_progress: 4,
  projects_completed: 3,
  projects_pending_review: 2,
  projects_archived: 1,
  total_tasks: 1234,
  total_annotations: 5678,
  ml_backends_total: 0,
  ml_backends_connected: 0,
  role_distribution: { super_admin: 1, project_admin: 2, annotator: 18, reviewer: 3, viewer: 1 },
  registration_by_day: [],
};

function renderUI(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminDashboard />
    </MemoryRouter>,
  );
}

describe("AdminDashboard", () => {
  beforeEach(() => {
    mockUseAdminStats.mockReset();
    mockUseProjects.mockReset();
    mockUseAuditLogs.mockReset();
    mockUseProjects.mockReturnValue({ data: [], isLoading: false });
    mockUseAuditLogs.mockReturnValue({ data: { items: [] } });
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseAdminStats.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("有 stats → 渲染主要 KPI 卡片", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.getByText("25")).toBeInTheDocument(); // total_users
    expect(screen.getByText("8 在线")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument(); // total_projects
    expect(screen.getByText("1,234")).toBeInTheDocument(); // total_tasks
    expect(screen.getByText("5,678")).toBeInTheDocument(); // total_annotations
  });

  it("ML backend 总数 0 → 空态文案", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.getByText("暂无已注册的 ML 后端")).toBeInTheDocument();
  });

  it("ML backend > 0 → 显示 X / Y 在线汇总", () => {
    const s = { ...baseStats, ml_backends_total: 3, ml_backends_connected: 2 };
    mockUseAdminStats.mockReturnValue({ data: s, isLoading: false });
    renderUI();
    expect(
      screen.getByText("已注册 3 个模型后端，2 个在线"),
    ).toBeInTheDocument();
  });

  it("注册来源 0 → 空态文案", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.getByText("过去 30 天暂无注册记录")).toBeInTheDocument();
  });

  it("注册来源有数据 → 显示总人数 + 邀请/开放分项", () => {
    const s = {
      ...baseStats,
      registration_by_day: [
        { date: "2026-01-01", invite_count: 3, open_count: 2 },
        { date: "2026-01-02", invite_count: 1, open_count: 4 },
      ],
    };
    mockUseAdminStats.mockReturnValue({ data: s, isLoading: false });
    renderUI();
    expect(screen.getByText("共 10 人 · 邀请 4 · 开放 6")).toBeInTheDocument();
  });

  it("项目列表 0 → 空态文案", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(
      screen.getByText("暂无项目，点击右上角「新建项目」开始"),
    ).toBeInTheDocument();
  });

  it("有项目 → 渲染项目行", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          display_id: "P-1",
          name: "Demo",
          type_label: "图像检测",
          type_key: "image-det",
          owner_name: "Alice",
          member_count: 5,
          status: "in_progress",
          total_tasks: 10,
          completed_tasks: 3,
          review_tasks: 1,
          ai_enabled: false,
        },
      ],
      isLoading: false,
    });
    renderUI();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // 「进行中」在 StatusBar 与项目状态徽章都出现，这里只断言出现至少 1 次
    expect(screen.getAllByText("进行中").length).toBeGreaterThan(0);
  });

  it("点击「新建项目」→ wizard open", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.queryByTestId("cp-wizard")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("新建项目"));
    expect(screen.getByTestId("cp-wizard")).toBeInTheDocument();
  });

  it("初始 ?new=1 → wizard 立即 open", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI("/dashboard?new=1");
    expect(screen.getByTestId("cp-wizard")).toBeInTheDocument();
  });

  it("点击「导入数据集」→ import wizard open", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.queryByTestId("id-wizard")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("导入数据集"));
    expect(screen.getByTestId("id-wizard")).toBeInTheDocument();
  });

  it("recentActivity 空 → 显示「暂无业务事件」", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    renderUI();
    expect(screen.getByText("暂无业务事件")).toBeInTheDocument();
  });

  it("audit 含 http.* 项被过滤掉，仅显示业务事件", () => {
    mockUseAdminStats.mockReturnValue({ data: baseStats, isLoading: false });
    mockUseAuditLogs.mockReturnValue({
      data: {
        items: [
          { id: "1", action: "http.get", actor_email: "a@x.com", created_at: new Date().toISOString() },
          { id: "2", action: "user.create", actor_email: "b@x.com", target_type: "user", target_id: "u1", created_at: new Date().toISOString() },
        ],
      },
    });
    renderUI();
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
    expect(screen.queryByText("a@x.com")).not.toBeInTheDocument();
  });
});
