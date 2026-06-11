/**
 * SettingsPage 单测 — 加载态 / 个人资料 / 系统设置 / 标注偏好 / 通知偏好 主路径.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockPushToast = vi.fn();

// --- auth store ---
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel: (s: any) => any) =>
    sel({
      token: "tok",
      user: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        role: "super_admin",
        group_name: null,
        deactivation_scheduled_at: null,
        deactivation_requested_at: null,
      },
      setAuth: vi.fn(),
    }),
}));

// --- permissions ---
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    role: "super_admin",
    hasPermission: () => true,
    hasAnyPermission: () => true,
    canAccessPage: () => true,
    allowedPages: [],
  }),
}));

// --- useMe mutations ---
const mockUpdateProfile = { mutate: vi.fn(), isPending: false, isError: false };
const mockChangePassword = { mutate: vi.fn(), isPending: false, isError: false };
const mockRequestDeactivation = { mutate: vi.fn(), isPending: false, isError: false };
const mockCancelDeactivation = { mutate: vi.fn(), isPending: false, isError: false };
vi.mock("@/hooks/useMe", () => ({
  useUpdateProfile: () => mockUpdateProfile,
  useChangePassword: () => mockChangePassword,
  useRequestDeactivation: () => mockRequestDeactivation,
  useCancelDeactivation: () => mockCancelDeactivation,
}));

// --- system settings ---
const mockSystemSettingsData = {
  environment: "development",
  allow_open_registration: false,
  invitation_ttl_days: 7,
  frontend_base_url: "http://localhost:3000",
  smtp: {
    host: "smtp.example.com",
    port: 587,
    user: "user@example.com",
    from_address: "noreply@example.com",
    configured: true,
    password_set: true,
  },
};
const mockUseSystemSettings = vi.fn();
const mockUpdateSystemSettings = { mutate: vi.fn(), isPending: false, isError: false };
const mockTestSmtp = { mutate: vi.fn(), isPending: false };
vi.mock("@/hooks/useSystemSettings", () => ({
  useSystemSettings: () => mockUseSystemSettings(),
  useUpdateSystemSettings: () => mockUpdateSystemSettings,
  useTestSmtp: () => mockTestSmtp,
}));

// --- workbench config ---
// v0.15.3 · 偏好四分树形态(common/image/video/pointcloud 子树)。
const mockWorkbenchConfig = {
  common: {
    longTaskSampleRate: 0.1,
    confirmDelete: "never",
    recentClassesLimit: 5,
    crossFrameOverlayK: 0,
  },
  image: {
    smoothImage: true,
    cssImageFilter: "",
    controlPointsSize: 6,
    autoFitOnResize: true,
    snapToGrid: false,
    afterBoxCreate: "pick_class",
    snapThresholdPx: 8,
    zoomStepFactor: 1.1,
    fadedOpacity: 0.35,
    showBoxLabels: true,
    maskOverlayOpacity: 0.45,
  },
  video: {
    defaultPlaybackRate: 1,
    largeFrameStep: 10,
  },
  pointcloud: {
    pointSize: 0.06,
    persistCameraView: false,
    colorizeWithCamera: false,
    colorizeContrast: 1,
    colorizeBrightness: 0,
    colorizeGamma: 1,
    showDepthHint: false,
    pointMaskSelectMode: "rect",
    showGrid: true,
    showAxisGizmo: true,
    cameraDamping: 0.1,
  },
};
const mockWorkbenchUpdate = vi.fn();
vi.mock("@/pages/Workbench/state/useWorkbenchConfig", () => ({
  useWorkbenchConfig: () => ({
    config: mockWorkbenchConfig,
    loaded: true,
    saving: false,
    update: mockWorkbenchUpdate,
  }),
}));

// --- bug reports API ---
vi.mock("@/api/bug-reports", () => ({
  bugReportsApi: {
    listMine: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

// --- notifications API ---
vi.mock("@/api/notifications", () => ({
  notificationsApi: {
    getPreferences: vi.fn().mockResolvedValue({
      items: [
        { type: "batch.rejected", in_app: true },
        { type: "bug_report.status_changed", in_app: false },
        { type: "job.completed", in_app: true },
      ],
    }),
    updatePreference: vi.fn().mockResolvedValue(undefined),
  },
}));

// --- toast ---
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { SettingsPage } from "./SettingsPage";

function renderUI() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockUpdateProfile.mutate.mockReset();
    mockChangePassword.mutate.mockReset();
    mockUpdateSystemSettings.mutate.mockReset();
    mockTestSmtp.mutate.mockReset();
    mockWorkbenchUpdate.mockReset().mockResolvedValue(undefined);
    mockUseSystemSettings.mockReturnValue({
      data: mockSystemSettingsData,
      isLoading: false,
      error: null,
    });
  });

  it("默认渲染个人资料 tab，显示邮箱与姓名", () => {
    renderUI();
    expect(screen.getByText("设置")).toBeInTheDocument();
    expect(screen.getByText("个人资料")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("保存按钮在姓名未变化时 disabled", () => {
    renderUI();
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn).toBeDisabled();
  });

  it("修改姓名后保存按钮 enabled，点击触发 updateProfile.mutate", () => {
    renderUI();
    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alice New" } });
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(mockUpdateProfile.mutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile.mutate.mock.calls[0][0]).toEqual({ name: "Alice New" });
  });

  it("修改密码：两次密码不一致时显示错误提示", () => {
    renderUI();
    fireEvent.change(screen.getAllByDisplayValue("")[0], { target: { value: "oldpass" } });
    const pwdInputs = screen.getAllByDisplayValue("");
    // 填入新密码
    fireEvent.change(pwdInputs[0], { target: { value: "newpass1" } });
    fireEvent.change(pwdInputs[1], { target: { value: "different2" } });
    expect(screen.getByText("两次密码不一致")).toBeInTheDocument();
  });

  it("点击「系统设置」tab → 显示系统设置表单（super_admin 才可见）", () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /系统设置/ }));
    expect(screen.getByText(/开放注册/)).toBeInTheDocument();
    expect(screen.getByText(/SMTP 邮件/)).toBeInTheDocument();
  });

  it("系统设置 - 系统设置 tab 加载中状态", () => {
    mockUseSystemSettings.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /系统设置/ }));
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("系统设置 - 修改 open registration 后保存触发 mutation", () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /系统设置/ }));
    // toggle the checkbox to dirty the form
    const checkbox = screen.getByLabelText(/已关闭.*仅邀请注册/);
    fireEvent.click(checkbox);
    fireEvent.submit(checkbox.closest("form")!);
    expect(mockUpdateSystemSettings.mutate).toHaveBeenCalledTimes(1);
    const patch = mockUpdateSystemSettings.mutate.mock.calls[0][0];
    expect(patch).toHaveProperty("allow_open_registration", true);
  });

  it("点击「标注偏好」tab → 显示图像平滑选项", () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /标注偏好/ }));
    expect(screen.getByText(/图像平滑/)).toBeInTheDocument();
  });

  it("点击「通知偏好」tab → 异步加载后显示通知类型", async () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /通知偏好/ }));
    await waitFor(() =>
      expect(screen.getByText("batch.rejected")).toBeInTheDocument(),
    );
    expect(screen.getByText("后台任务完成")).toBeInTheDocument();
  });

  it("点击「我的反馈」tab → 显示空态提示", async () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /我的反馈/ }));
    await waitFor(() =>
      expect(screen.getByText(/暂无反馈记录/)).toBeInTheDocument(),
    );
  });

  it("危险区：点击「申请注销账号」展开确认面板", () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /申请注销账号/ }));
    expect(screen.getAllByText(/7 天冷静期/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /确认申请注销/ })).toBeDisabled();
  });
});
