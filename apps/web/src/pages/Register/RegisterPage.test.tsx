/**
 * v0.8.5 · RegisterPage 单测：开放注册 / 邀请注册 双形态。
 * - 已登录跳 dashboard
 * - 注册未开放空态
 * - 密码强度校验各项
 * - 两次密码不一致
 * - 提交流（OpenRegister / InviteRegister）
 * - 邀请 token 失效（404 / 410）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

const mockResolve: any = { isLoading: false, isError: false, error: null, data: null };
const mockRegister: any = { isPending: false, isError: false, error: null, mutate: vi.fn() };
const mockOpenRegister: any = { isPending: false, isError: false, error: null, mutate: vi.fn() };
const mockRegStatus: any = { isLoading: false, data: { open_registration_enabled: true } };

vi.mock("@/hooks/useInvitation", () => ({
  useResolveInvitation: () => mockResolve,
  useRegister: () => mockRegister,
  useRegistrationStatus: () => mockRegStatus,
  useOpenRegister: () => mockOpenRegister,
}));

import { RegisterPage } from "./RegisterPage";

function renderUI(initialPath = "/register") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillPwd(pwd: string, pwd2 = pwd) {
  const all = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
  fireEvent.change(all[0], { target: { value: pwd } });
  fireEvent.change(all[1], { target: { value: pwd2 } });
}

describe("RegisterPage / OpenRegisterForm", () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    mockResolve.isLoading = false;
    mockResolve.isError = false;
    mockResolve.error = null;
    mockResolve.data = null;
    mockRegister.isPending = false;
    mockRegister.isError = false;
    mockRegister.error = null;
    mockRegister.mutate = vi.fn();
    mockOpenRegister.isPending = false;
    mockOpenRegister.isError = false;
    mockOpenRegister.error = null;
    mockOpenRegister.mutate = vi.fn();
    mockRegStatus.isLoading = false;
    mockRegStatus.data = { open_registration_enabled: true };
  });

  it("已登录 → 重定向到 /dashboard", () => {
    useAuthStore.setState({ token: "tok", user: { id: "u1" } as any });
    renderUI();
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
  });

  it("regStatus 加载中 → 加载提示", () => {
    mockRegStatus.isLoading = true;
    renderUI();
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("注册未开放 → ErrorPanel 文案", () => {
    mockRegStatus.data = { open_registration_enabled: false };
    renderUI();
    expect(screen.getByText("注册未开放")).toBeInTheDocument();
  });

  it("PasswordStrengthIndicator 弱密码 → 4 条规则全 ✗", () => {
    renderUI();
    const pwds = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwds[0], { target: { value: "abc" } });
    expect(screen.getByText(/✗ 至少 8 位/)).toBeInTheDocument();
    expect(screen.getByText(/✗ 含大写字母/)).toBeInTheDocument();
    // "abc" 全小写 → lowercase ✓；length / uppercase / digit 失败
    expect(screen.getByText(/✓ 含小写字母/)).toBeInTheDocument();
    expect(screen.getByText(/✗ 含数字/)).toBeInTheDocument();
  });

  it("PasswordStrengthIndicator 合规密码 → 4 条全 ✓", () => {
    renderUI();
    const pwds = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwds[0], { target: { value: "Abcdef12" } });
    expect(screen.getByText(/✓ 至少 8 位/)).toBeInTheDocument();
    expect(screen.getByText(/✓ 含大写字母/)).toBeInTheDocument();
    expect(screen.getByText(/✓ 含小写字母/)).toBeInTheDocument();
    expect(screen.getByText(/✓ 含数字/)).toBeInTheDocument();
  });

  it("两次密码不一致 → 显示「两次密码不一致」错误", () => {
    renderUI();
    fillPwd("Abcdef12", "Abcdef13");
    expect(screen.getByText("两次密码不一致")).toBeInTheDocument();
  });

  it("eye toggle 切换密码可见性", () => {
    renderUI();
    const pwds = document.querySelectorAll('input[type="password"]');
    expect(pwds.length).toBe(2);
    fireEvent.click(screen.getAllByLabelText("切换密码可见性")[0]);
    expect(document.querySelectorAll('input[type="text"]').length).toBeGreaterThanOrEqual(1);
  });

  it("有效填写 → 提交调用 openRegister.mutate", () => {
    renderUI();
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "x@y.com" } }); // email
    fireEvent.change(inputs[1], { target: { value: "Tom" } }); // name
    fillPwd("Abcdef12");
    fireEvent.click(screen.getByText("注册"));
    expect(mockOpenRegister.mutate).toHaveBeenCalledWith(
      { email: "x@y.com", name: "Tom", password: "Abcdef12" },
      expect.any(Object),
    );
  });

  it("空 email 或 name → 不调用 mutate", () => {
    renderUI();
    fillPwd("Abcdef12");
    fireEvent.click(screen.getByText("注册"));
    expect(mockOpenRegister.mutate).not.toHaveBeenCalled();
  });

  it("提交成功 → 跳 /dashboard", () => {
    mockOpenRegister.mutate = vi.fn((_args, opts) =>
      opts?.onSuccess?.({
        access_token: "tok",
        user: { id: "u1", email: "x@y.com", name: "Tom", role: "viewer" },
      }),
    );
    renderUI();
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "x@y.com" } });
    fireEvent.change(inputs[1], { target: { value: "Tom" } });
    fillPwd("Abcdef12");
    fireEvent.click(screen.getByText("注册"));
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
  });

  it("openRegister.isError → 显示错误条", () => {
    mockOpenRegister.isError = true;
    mockOpenRegister.error = new Error("邮箱已被占用");
    renderUI();
    expect(screen.getByText("邮箱已被占用")).toBeInTheDocument();
  });

  it("openRegister.isPending → 按钮显示注册中", () => {
    mockOpenRegister.isPending = true;
    renderUI();
    expect(screen.getByText("注册中...")).toBeInTheDocument();
  });
});

describe("RegisterPage / InviteRegisterForm", () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    mockResolve.isLoading = false;
    mockResolve.isError = false;
    mockResolve.error = null;
    mockResolve.data = null;
    mockRegister.isPending = false;
    mockRegister.isError = false;
    mockRegister.error = null;
    mockRegister.mutate = vi.fn();
  });

  it("resolve 加载中 → 显示「正在校验邀请链接…」", () => {
    mockResolve.isLoading = true;
    renderUI("/register?token=abc");
    expect(screen.getByText("正在校验邀请链接…")).toBeInTheDocument();
  });

  it("邀请 404 → 显示「邀请链接无效」", () => {
    mockResolve.isError = true;
    mockResolve.error = { status: 404 } as any;
    renderUI("/register?token=abc");
    expect(screen.getByText("邀请链接无效")).toBeInTheDocument();
  });

  it("邀请 410 → 显示 err.message 或默认失效文案", () => {
    mockResolve.isError = true;
    mockResolve.error = { status: 410, message: "已过期" } as any;
    renderUI("/register?token=abc");
    expect(screen.getByText("已过期")).toBeInTheDocument();
  });

  it("邀请通过 → 渲染表单 + email pill", () => {
    mockResolve.data = {
      email: "x@y.com",
      role: "annotator",
      invited_by_name: "Alice",
      group_name: "G1",
      expires_at: new Date(Date.now() + 86400000 * 3).toISOString(),
    };
    renderUI("/register?token=abc");
    expect(screen.getByText("设置你的账号")).toBeInTheDocument();
    expect(screen.getByText("x@y.com")).toBeInTheDocument();
    expect(screen.getByText("G1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("邀请提交流 → 调用 register.mutate(token, name, password)", () => {
    mockResolve.data = {
      email: "x@y.com",
      role: "annotator",
      invited_by_name: "Alice",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    mockRegister.mutate = vi.fn((_args, opts) =>
      opts?.onSuccess?.({
        access_token: "tok",
        user: { id: "u2", email: "x@y.com", name: "Bob", role: "annotator" },
      }),
    );
    renderUI("/register?token=abc");
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "Bob" } }); // name
    fillPwd("Abcdef12");
    fireEvent.click(screen.getByText("完成注册并登录"));
    expect(mockRegister.mutate).toHaveBeenCalledWith(
      { token: "abc", name: "Bob", password: "Abcdef12" },
      expect.any(Object),
    );
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
  });

  it("邀请提交失败 → 显示错误条", () => {
    mockResolve.data = {
      email: "x@y.com",
      role: "annotator",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    mockRegister.isError = true;
    mockRegister.error = new Error("邀请已过期");
    renderUI("/register?token=abc");
    expect(screen.getByText("邀请已过期")).toBeInTheDocument();
  });

  it("无效填写 → 不调用 register.mutate", () => {
    mockResolve.data = {
      email: "x@y.com",
      role: "annotator",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    renderUI("/register?token=abc");
    fillPwd("weakpwd"); // 不合规
    fireEvent.click(screen.getByText("完成注册并登录"));
    expect(mockRegister.mutate).not.toHaveBeenCalled();
  });
});
