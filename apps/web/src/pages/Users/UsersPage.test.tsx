/**
 * UsersPage 单测 — 成员列表 / tab 切换 / 导出 / 删除确认弹窗 主路径.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockPushToast = vi.fn();
const mockDeleteMutateAsync = vi.fn();
const mockDeleteReset = vi.fn();

// --- useUsers / useUsersStats / useDeleteUser ---
const mockUseUsers = vi.fn();
const mockUseUsersStats = vi.fn();
vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => mockUseUsers(),
  useUsersStats: () => mockUseUsersStats(),
  useDeleteUser: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
    error: null,
    reset: mockDeleteReset,
  }),
}));

// --- useGroups ---
const mockUseGroups = vi.fn();
vi.mock("@/hooks/useGroups", () => ({
  useGroups: () => mockUseGroups(),
}));

// --- usePermissions ---
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    role: "super_admin",
    hasPermission: () => true,
    hasAnyPermission: () => true,
    canAccessPage: () => true,
    allowedPages: [],
  }),
}));

// --- authStore ---
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel: (s: any) => any) =>
    sel({
      token: "tok",
      user: { id: "me-id", name: "Admin", email: "admin@example.com", role: "super_admin" },
    }),
}));

// --- usersApi (for exportUsers, adminResetPassword) ---
const mockExportUsers = vi.fn();
vi.mock("@/api/users", () => ({
  usersApi: {
    exportUsers: (...args: unknown[]) => mockExportUsers(...args),
    adminResetPassword: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    detailRaw: unknown;
    constructor(msg: string, status: number, detailRaw?: unknown) {
      super(msg);
      this.status = status;
      this.detailRaw = detailRaw;
    }
  },
}));

// --- api/client ApiError (imported directly in UsersPage) ---
vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    detailRaw: unknown;
    constructor(msg: string, status: number, detailRaw?: unknown) {
      super(msg);
      this.status = status;
      this.detailRaw = detailRaw;
    }
  },
}));

// --- modal sub-components: stub to avoid deep import chains ---
vi.mock("@/components/users/InviteUserModal", () => ({
  InviteUserModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="invite-modal">InviteModal</div> : null,
}));
vi.mock("@/components/users/EditUserModal", () => ({
  EditUserModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-modal">EditModal</div> : null,
}));
vi.mock("@/components/users/GroupManageModal", () => ({
  GroupManageModal: () => null,
}));
vi.mock("@/components/users/InvitationListPanel", () => ({
  InvitationListPanel: () => <div data-testid="invitation-panel">InvitationPanel</div>,
}));

// --- toast ---
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { UsersPage } from "./UsersPage";

const SAMPLE_USERS = [
  {
    id: "u1",
    name: "Alice",
    email: "alice@example.com",
    role: "annotator",
    is_active: true,
    status: "online",
    group_id: null,
    group_name: null,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "u2",
    name: "Bob",
    email: "bob@example.com",
    role: "reviewer",
    is_active: true,
    status: "offline",
    group_id: null,
    group_name: null,
    created_at: "2026-02-01T00:00:00Z",
  },
];

function renderUI() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

describe("UsersPage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockExportUsers.mockReset().mockResolvedValue(undefined);
    mockDeleteMutateAsync.mockReset().mockResolvedValue(undefined);
    mockDeleteReset.mockReset();
    mockUseUsersStats.mockReturnValue({ data: { weekly_active: 5, online: 2 } });
    mockUseGroups.mockReturnValue({ data: [] });
    mockUseUsers.mockReturnValue({ data: SAMPLE_USERS, isLoading: false });
  });

  it("渲染页面标题与成员表格", () => {
    renderUI();
    expect(screen.getByText("用户与权限")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("isLoading=true → 显示「加载中...」", () => {
    mockUseUsers.mockReturnValue({ data: [], isLoading: true });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("搜索框过滤：输入 'Alice' 后只显示 Alice", () => {
    renderUI();
    const searchInput = screen.getByPlaceholderText(/搜索姓名或邮箱/);
    fireEvent.change(searchInput, { target: { value: "Alice" } });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("点击「角色」tab → 显示角色卡片", () => {
    renderUI();
    const roleTab = screen.getAllByRole("button").find((b) => b.textContent?.includes("角色"));
    fireEvent.click(roleTab!);
    // 角色 tab 里应该显示 ROLE_LABELS 的角色名
    expect(screen.getByText(/超级管理员|系统管理员|super/i)).toBeInTheDocument();
  });

  it("点击「邀请记录」tab → 渲染 InvitationListPanel", () => {
    renderUI();
    const invTab = screen.getAllByRole("button").find((b) => b.textContent?.includes("邀请记录"));
    fireEvent.click(invTab!);
    expect(screen.getByTestId("invitation-panel")).toBeInTheDocument();
  });

  it("点击「导出名单」→ 调用 exportUsers + toast 成功", async () => {
    renderUI();
    const exportBtn = screen.getByRole("button", { name: /导出名单/ });
    fireEvent.click(exportBtn);
    await waitFor(() => expect(mockExportUsers).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" })),
    );
  });

  it("点击「邀请成员」→ 显示 InviteModal", () => {
    renderUI();
    const inviteBtn = screen.getByRole("button", { name: /邀请成员/ });
    fireEvent.click(inviteBtn);
    expect(screen.getByTestId("invite-modal")).toBeInTheDocument();
  });

  it("点击删除按钮 → 显示确认弹窗", () => {
    renderUI();
    // 删除按钮 title="删除账号"
    const deleteBtn = screen.getAllByTitle("删除账号")[0];
    fireEvent.click(deleteBtn);
    expect(screen.getByText(/确认删除以下账号/)).toBeInTheDocument();
  });

  it("删除确认弹窗 → 点取消关闭弹窗", () => {
    renderUI();
    fireEvent.click(screen.getAllByTitle("删除账号")[0]);
    expect(screen.getByText(/确认删除以下账号/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText(/确认删除以下账号/)).not.toBeInTheDocument();
  });

  it("数据组 tab 空态 → 显示暂无数据组提示", () => {
    mockUseGroups.mockReturnValue({ data: [] });
    renderUI();
    const groupTab = screen.getAllByRole("button").find((b) => b.textContent?.includes("数据组"));
    fireEvent.click(groupTab!);
    expect(screen.getByText(/暂无数据组/)).toBeInTheDocument();
  });
});
