/**
 * UsersPage 单测 — 成员列表 / tab 切换 / 导出 / 删除确认弹窗 主路径.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

const mockPushToast = vi.fn();
const mockDeleteMutateAsync = vi.fn();
const mockDeleteReset = vi.fn();

// --- useUsers / useUsersStats / useDeleteUser ---
const mockUseUsers = vi.fn();
const mockUseUsersStats = vi.fn();
vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
  useUserPage: (params: any) => {
    const response = mockUseUsers(params);
    const items = response.data?.filter(
      (user: any) =>
        (!params.role || user.role === params.role) &&
        (!params.search ||
          `${user.name} ${user.email}`.toLowerCase().includes(params.search.toLowerCase())),
    );
    return {
      ...response,
      data: items && {
        items,
        total: response.total ?? items.length,
        page: params.page,
        page_size: params.page_size,
        pages: response.pages ?? 1,
      },
    };
  },
  useUsersStats: (params: unknown) => mockUseUsersStats(params),
  useDeleteUser: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
    error: null,
    reset: mockDeleteReset,
  }),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({ data: [{ id: "project-1", name: "Test project" }] }),
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
vi.mock("@/components/users/BulkInviteModal", () => ({
  BulkInviteModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bulk-invite-modal">BulkInviteModal</div> : null,
}));
vi.mock("@/components/users/BulkGroupAssignmentModal", () => ({
  BulkGroupAssignmentModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bulk-group-modal">BulkGroupAssignmentModal</div> : null,
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
vi.mock("@/components/users/OffboardingDialog", () => ({
  OffboardingDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="offboarding-dialog">OffboardingDialog</div> : null,
  ReactivateDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="reactivate-dialog">ReactivateDialog</div> : null,
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

const INACTIVE_USER = {
  id: "u3",
  name: "Emergency Bob",
  email: "emergency@example.com",
  role: "annotator",
  is_active: false,
  disabled_kind: "emergency_suspended",
  disabled_at: "2026-09-08T10:00:00Z",
  disabled_reason: "账号疑似泄露",
  status: "offline",
  group_id: null,
  group_name: null,
  created_at: "2026-03-01T00:00:00Z",
};

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location-search">{location.search}</output>
      <button aria-label="浏览器后退" onClick={() => navigate(-1)} />
      <button aria-label="浏览器前进" onClick={() => navigate(1)} />
    </>
  );
}

function renderUI(initialEntries: string | string[] = "/users", initialIndex?: number) {
  const entries = Array.isArray(initialEntries) ? initialEntries : [initialEntries];
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <LocationProbe />
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

  it("resumes search while a browser-navigation draft is still debouncing", async () => {
    vi.useFakeTimers();
    mockUseUsers.mockReturnValue({ data: SAMPLE_USERS, total: 1000, pages: 40, isLoading: false });
    const view = renderUI([
      "/users?q=restored&page=3&status=all&role=annotator&keep=yes",
      "/users?q=old&status=all&role=annotator&keep=yes",
    ]);
    const params = () =>
      new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
    try {
      fireEvent.click(screen.getByRole("button", { name: "浏览器后退" }));
      const input = screen.getByPlaceholderText(/搜索姓名或邮箱/);
      expect(input).toHaveValue("restored");
      await act(async () => vi.advanceTimersByTime(100));
      fireEvent.change(input, { target: { value: "Alice" } });
      fireEvent.change(screen.getByLabelText("账号状态"), { target: { value: "inactive" } });
      await act(async () => vi.advanceTimersByTime(249));
      expect(params().get("q")).toBe("restored");
      await act(async () => vi.advanceTimersByTime(1));
      expect(params().get("q")).toBe("Alice");
      expect(params().get("page")).toBeNull();
      expect(params().get("status")).toBe("inactive");
      expect(params().get("role")).toBe("annotator");
      expect(params().get("keep")).toBe("yes");
      expect(mockUseUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Alice", page: 1 }),
      );
      fireEvent.change(input, { target: { value: "Alice updated" } });
      await act(async () => vi.advanceTimersByTime(250));
      expect(params().get("q")).toBe("Alice updated");
      expect(mockUseUsersStats).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Alice updated" }),
      );
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("搜索框过滤：输入 'Alice' 后只显示 Alice", async () => {
    renderUI();
    const searchInput = screen.getByPlaceholderText(/搜索姓名或邮箱/);
    fireEvent.change(searchInput, { target: { value: "Alice" } });
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    });
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

  it("账号状态筛选显示已停用账号，并保留继续交接与恢复入口", () => {
    mockUseUsers.mockReturnValue({ data: [INACTIVE_USER], isLoading: false });
    renderUI();
    fireEvent.change(screen.getByLabelText("账号状态"), { target: { value: "inactive" } });
    expect(screen.getByText("Emergency Bob")).toBeInTheDocument();
    expect(screen.getByText("紧急停用")).toBeInTheDocument();
    expect(screen.getByTitle("继续交接")).toBeInTheDocument();
    expect(screen.getByTitle("恢复账号")).toBeInTheDocument();
    expect(screen.queryByTitle("删除账号")).not.toBeInTheDocument();
  });

  it("初次离线且没有用户数据时显示等待网络恢复，而不是空列表", () => {
    mockUseUsers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      fetchStatus: "paused",
    });
    renderUI();
    expect(screen.getByText("暂时离线，等待网络恢复")).toBeInTheDocument();
    expect(screen.getByText(/网络恢复后会自动继续加载用户列表/)).toBeInTheDocument();
    expect(screen.queryByText(/暂无启用账号/)).not.toBeInTheDocument();
  });

  it("已有用户数据但请求暂停时保留旧数据并显示离线提示", () => {
    mockUseUsers.mockReturnValue({
      data: SAMPLE_USERS,
      isLoading: false,
      isError: false,
      fetchStatus: "paused",
    });
    renderUI();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/当前离线，正在等待网络恢复/)).toBeInTheDocument();
  });
  it("paginates 1000 members and passes the same project and role filters to stats and export", async () => {
    mockUseUsers.mockReturnValue({ data: SAMPLE_USERS, total: 1000, pages: 40, isLoading: false });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(mockUseUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, page_size: 25 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("项目筛选"), { target: { value: "project-1" } });
    fireEvent.change(screen.getByLabelText("角色筛选"), { target: { value: "annotator" } });
    expect(mockUseUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ project_id: "project-1", role: "annotator", page: 1 }),
    );
    expect(mockUseUsersStats).toHaveBeenLastCalledWith(
      expect.objectContaining({ project_id: "project-1", role: "annotator", status: "active" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /导出名单/ }));
    await waitFor(() =>
      expect(mockExportUsers).toHaveBeenCalledWith(
        "csv",
        expect.objectContaining({ project_id: "project-1", role: "annotator", status: "active" }),
      ),
    );
  });

  it("clears selected members when filters change and preserves them across pages", async () => {
    mockUseUsers.mockReturnValue({ data: SAMPLE_USERS, total: 1000, pages: 40, isLoading: false });
    renderUI("/users?page=2");

    fireEvent.click(screen.getByLabelText("选择 Alice"));
    expect(screen.getByText(/已选择 1 名成员/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("角色筛选"), { target: { value: "annotator" } });
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("?role=annotator"),
    );
    expect(screen.queryByText(/已选择 1 名成员/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("?role=annotator&page=2"),
    );
    fireEvent.click(screen.getByLabelText("选择 Alice"));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("?role=annotator&page=3"),
    );
    expect(screen.getByText(/已选择 1 名成员/)).toBeInTheDocument();
  });

  it("rehydrates filter state on browser back and forward", async () => {
    mockUseUsers.mockReturnValue({ data: SAMPLE_USERS, total: 1000, pages: 40, isLoading: false });
    renderUI(["/users", "/users?status=inactive&page=2&q=Alice&project_id=project-1"], 1);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByLabelText("账号状态")).toHaveValue("inactive");
    expect(screen.getByPlaceholderText(/搜索姓名或邮箱/)).toHaveValue("Alice");
    expect(screen.getByLabelText("项目筛选")).toHaveValue("project-1");
    fireEvent.click(screen.getByLabelText("选择 Alice"));
    expect(screen.getByText(/已选择 1 名成员/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "浏览器后退" }));
    await waitFor(() => {
      expect(screen.getByLabelText("账号状态")).toHaveValue("active");
      expect(screen.getByTestId("location-search")).toHaveTextContent(/^$/);
    });
    expect(screen.queryByText(/已选择 1 名成员/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "浏览器前进" }));
    await waitFor(() => {
      expect(screen.getByLabelText("账号状态")).toHaveValue("inactive");
      expect(screen.getByPlaceholderText(/搜索姓名或邮箱/)).toHaveValue("Alice");
      expect(screen.getByLabelText("项目筛选")).toHaveValue("project-1");
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "?status=inactive&page=2&q=Alice&project_id=project-1",
      );
      expect(mockUseUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "inactive",
          project_id: "project-1",
          search: "Alice",
          page: 2,
          page_size: 25,
        }),
      );
    });
  });

  it("records discrete member filter changes as browser history entries", async () => {
    mockUseUsers.mockReturnValue({ data: SAMPLE_USERS, total: 1000, pages: 40, isLoading: false });
    renderUI(["/users", "/users?status=inactive"], 0);

    fireEvent.change(screen.getByLabelText("账号状态"), { target: { value: "inactive" } });
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("?status=inactive");
    });

    fireEvent.click(screen.getByRole("button", { name: "浏览器后退" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent(/^$/);
      expect(screen.getByLabelText("账号状态")).toHaveValue("active");
    });
  });
});
