/**
 * DashboardPage 单测 — 加载态 / 空态 / 正常渲染 / 视图切换 / 活动日志过滤.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

type MockAuthState = {
  user: { id: string; role: string; email: string } | null;
};

type OpenModalProps = {
  open?: boolean;
};

const mockUseProjects = vi.fn();
const mockUseProjectStats = vi.fn();
const mockUseAuditLogs = vi.fn();
const mockPushToast = vi.fn();
const mockAuthStore = vi.fn(<T,>(sel: (s: MockAuthState) => T) => sel({ user: null }));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: (...args: unknown[]) => mockUseProjects(...args),
  useProjectStats: () => mockUseProjectStats(),
}));

vi.mock("@/hooks/useAudit", () => ({
  useAuditLogs: () => mockUseAuditLogs(),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: <T,>(sel: (s: MockAuthState) => T) => mockAuthStore(sel),
}));

vi.mock("@/components/projects/CreateProjectWizard", () => ({
  CreateProjectWizard: ({ open }: OpenModalProps) => (open ? <div data-testid="cp-wizard" /> : null),
}));

vi.mock("@/components/datasets/ImportDatasetWizard", () => ({
  ImportDatasetWizard: ({ open }: OpenModalProps) => (open ? <div data-testid="id-wizard" /> : null),
}));

vi.mock("./FilterDrawer", () => ({
  FilterDrawer: () => null,
  EMPTY_FILTERS: { data_type: [], member_id: undefined, created_from: undefined, created_to: undefined, status: undefined },
}));

vi.mock("./ProjectGrid", () => ({
  ProjectGrid: () => <div data-testid="project-grid" />,
}));

vi.mock("./ExportSection", () => ({
  ExportSection: () => null,
}));

vi.mock("@/components/guards/Can", () => ({
  Can: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/utils/workbenchNavigation", () => ({
  buildWorkbenchUrl: (_id: string) => `/workbench/${_id}`,
  currentWorkbenchReturnTo: () => "/dashboard",
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/Toast")>(
    "@/components/ui/Toast",
  );
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: { push: typeof mockPushToast }) => T) =>
      sel({ push: mockPushToast }),
  };
});

import { DashboardPage } from "./DashboardPage";

const baseUser = { id: "u1", role: "super_admin", email: "admin@x.com" };

function renderUI(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockAuthStore.mockImplementation(<T,>(sel: (s: MockAuthState) => T) =>
      sel({ user: baseUser }),
    );
    mockUseProjectStats.mockReturnValue({ data: undefined });
    mockUseAuditLogs.mockReturnValue({ data: { items: [] } });
    mockUseProjects.mockReturnValue({ data: [], isLoading: false });
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseProjects.mockReturnValue({ data: [], isLoading: true });
    renderUI();
    expect(screen.getAllByText("加载中...").length).toBeGreaterThan(0);
  });

  it("空项目列表 → 显示「没有匹配的项目」", () => {
    renderUI();
    expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();
  });

  it("有项目 → 渲染项目行", () => {
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          display_id: "P-1",
          name: "Demo项目",
          type_label: "图像 · 目标检测",
          type_key: "image-det",
          data_type: "image",
          tool_bindings: { bbox: { enabled: true } },
          owner_id: "u1",
          owner_name: "Alice",
          member_count: 3,
          status: "in_progress",
          total_tasks: 10,
          completed_tasks: 5,
          review_tasks: 2,
          in_progress_tasks: 1,
          ai_enabled: false,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      isLoading: false,
    });
    renderUI();
    expect(screen.getByText("Demo项目")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("P-1")).toBeInTheDocument();
    expect(screen.getByText("图片 · 矩形框")).toBeInTheDocument();
    expect(screen.queryByText("图像 · 目标检测")).not.toBeInTheDocument();
  });

  it("项目已解绑 backend 时不显示旧 ai_model", () => {
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          display_id: "P-1",
          name: "Demo项目",
          type_label: "视频 · 时序追踪",
          type_key: "video-track",
          data_type: "video",
          tool_bindings: { bbox: { enabled: true } },
          owner_id: "u1",
          owner_name: "Alice",
          member_count: 1,
          status: "in_progress",
          total_tasks: 2,
          completed_tasks: 0,
          review_tasks: 0,
          in_progress_tasks: 0,
          ai_enabled: true,
          ai_model: "gsam2-video",
          ml_backend_id: null,
          updated_at: "2026-05-22T00:00:00Z",
        },
      ],
      isLoading: false,
    });
    renderUI();
    expect(screen.queryByText("gsam2-video")).not.toBeInTheDocument();
    expect(screen.getByText("未接入模型")).toBeInTheDocument();
    expect(screen.getByText("视频 · 单帧框 / 轨迹框")).toBeInTheDocument();
    expect(screen.queryByText("视频 · 时序追踪")).not.toBeInTheDocument();
  });

  it("有 stats → stat 卡片渲染正确数值", () => {
    mockUseProjectStats.mockReturnValue({
      data: {
        total_data: 1234,
        completed: 567,
        ai_rate: 42,
        pending_review: 89,
      },
    });
    renderUI();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("audit 含 http.* 项被过滤，只显示业务事件", () => {
    mockUseAuditLogs.mockReturnValue({
      data: {
        items: [
          { id: "1", action: "http.get", actor_email: "a@x.com", created_at: new Date().toISOString() },
          { id: "2", action: "user.login", actor_email: "b@x.com", target_type: "user", target_id: "u2", created_at: new Date().toISOString() },
        ],
      },
    });
    renderUI();
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
    expect(screen.queryByText("a@x.com")).not.toBeInTheDocument();
  });

  it("audit 全空 → 显示「暂无业务事件」", () => {
    renderUI();
    expect(screen.getByText("暂无业务事件")).toBeInTheDocument();
  });

  it("点击视图切换按钮 → URL 追加 layout=grid 并渲染 ProjectGrid", () => {
    mockUseProjects.mockReturnValue({ data: [], isLoading: false });
    renderUI();
    // 切换到网格视图
    const toggleBtn = screen.getByTitle(/切换到网格视图/);
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("project-grid")).toBeInTheDocument();
  });

  it("初始 ?new=1 → CreateProjectWizard 立即 open", () => {
    renderUI("/dashboard?new=1");
    expect(screen.getByTestId("cp-wizard")).toBeInTheDocument();
  });
});
