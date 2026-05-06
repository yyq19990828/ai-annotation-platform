/**
 * v0.8.5 · InviteUserModal 单测：open=false 不渲染 / 角色选项随 actor / 提交流 /
 * 错误提示 / 邀请生成后切到结果视图 + 复制 + 继续邀请。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useAuthStore } from "@/stores/authStore";

const mockMutate = vi.fn();
const mockReset = vi.fn();
const mutationState: any = {
  isPending: false,
  isError: false,
  error: null,
  mutate: mockMutate,
  reset: mockReset,
};
const mockPushToast = vi.fn();

vi.mock("@/hooks/useInvitation", () => ({
  useInviteUser: () => mutationState,
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { InviteUserModal } from "./InviteUserModal";

function setRole(role: string | null) {
  useAuthStore.setState({
    user: role
      ? ({
          id: "u1",
          email: "u@x.com",
          name: "U",
          role,
          status: "online",
        } as any)
      : null,
  });
}

describe("InviteUserModal", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockReset.mockReset();
    mockPushToast.mockReset();
    mutationState.isPending = false;
    mutationState.isError = false;
    mutationState.error = null;
    setRole("super_admin");
  });

  it("open=false → 不渲染", () => {
    render(<InviteUserModal open={false} onClose={() => {}} />);
    expect(screen.queryByText("邀请新成员")).not.toBeInTheDocument();
  });

  it("super_admin → 角色 select 含 5 个选项", () => {
    setRole("super_admin");
    render(<InviteUserModal open={true} onClose={() => {}} />);
    const select = screen.getByDisplayValue(/超管|超级|管理员/) as HTMLSelectElement;
    expect(select.options.length).toBe(5);
  });

  it("project_admin → 角色 select 仅 3 个选项（无 super_admin / project_admin）", () => {
    setRole("project_admin");
    render(<InviteUserModal open={true} onClose={() => {}} />);
    const selects = document.querySelectorAll("select");
    expect(selects.length).toBe(1);
    expect((selects[0] as HTMLSelectElement).options.length).toBe(3);
  });

  it("annotator → 角色 select 0 选项（虽允许打开但无可邀请角色）", () => {
    setRole("annotator");
    render(<InviteUserModal open={true} onClose={() => {}} />);
    const sel = document.querySelector("select") as HTMLSelectElement;
    expect(sel.options.length).toBe(0);
  });

  it("空 email 提交 → 不调用 invite.mutate", () => {
    render(<InviteUserModal open={true} onClose={() => {}} />);
    const form = document.querySelector("form")!;
    fireEvent.submit(form);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("有效填写后提交 → 调用 invite.mutate(规范化 email + role)", () => {
    render(<InviteUserModal open={true} onClose={() => {}} />);
    const email = screen.getByPlaceholderText("newuser@your-org.com") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "  Tom@Example.COM  " } });
    fireEvent.change(screen.getByDisplayValue(/超管|超级|管理员/), {
      target: { value: "annotator" },
    });
    fireEvent.change(screen.getByPlaceholderText("例如：标注组A"), {
      target: { value: "  群组1  " },
    });
    fireEvent.click(screen.getByText("生成邀请链接"));
    expect(mockMutate).toHaveBeenCalledWith(
      { email: "tom@example.com", role: "annotator", group_name: "群组1" },
      expect.any(Object),
    );
  });

  it("空 group_name → 入参不带 group_name 字段（undefined）", () => {
    render(<InviteUserModal open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("newuser@your-org.com"), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByText("生成邀请链接"));
    const arg = mockMutate.mock.calls[0][0];
    expect(arg.group_name).toBeUndefined();
  });

  it("invite.isPending → 按钮显示「生成中...」+ disabled", () => {
    mutationState.isPending = true;
    render(<InviteUserModal open={true} onClose={() => {}} />);
    const btn = screen.getByText("生成中...") as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn.closest("button")?.disabled).toBe(true);
  });

  it("invite.isError → 显示错误信息", () => {
    mutationState.isError = true;
    mutationState.error = new Error("邮箱已存在");
    render(<InviteUserModal open={true} onClose={() => {}} />);
    expect(screen.getByText("邮箱已存在")).toBeInTheDocument();
  });

  it("成功生成 → 切到结果视图，显示链接 + 复制按钮", async () => {
    mockMutate.mockImplementation((_args, opts) =>
      opts?.onSuccess?.({
        invite_url: "https://x.com/invite?t=abc",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    );
    render(<InviteUserModal open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("newuser@your-org.com"), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByText("生成邀请链接"));
    await waitFor(() => screen.getByText("邀请已生成"));
    expect(screen.getByDisplayValue("https://x.com/invite?t=abc")).toBeInTheDocument();
    expect(screen.getByText("复制")).toBeInTheDocument();
    expect(screen.getByText("继续邀请")).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
  });

  it("点击复制 → 调用 clipboard 并 toast", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    mockMutate.mockImplementation((_args, opts) =>
      opts?.onSuccess?.({
        invite_url: "https://x.com/invite?t=abc",
        expires_at: new Date(Date.now() + 86400000 * 5).toISOString(),
      }),
    );
    render(<InviteUserModal open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("newuser@your-org.com"), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByText("生成邀请链接"));
    await waitFor(() => screen.getByText("邀请已生成"));
    fireEvent.click(screen.getByText("复制"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://x.com/invite?t=abc",
      );
    });
    expect(mockPushToast).toHaveBeenCalledWith({
      msg: "邀请链接已复制",
      kind: "success",
    });
  });

  it("点击「继续邀请」→ 切回表单视图", async () => {
    mockMutate.mockImplementation((_args, opts) =>
      opts?.onSuccess?.({
        invite_url: "https://x.com/invite?t=abc",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    );
    render(<InviteUserModal open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("newuser@your-org.com"), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByText("生成邀请链接"));
    await waitFor(() => screen.getByText("邀请已生成"));
    fireEvent.click(screen.getByText("继续邀请"));
    expect(screen.getByText("邀请新成员")).toBeInTheDocument();
  });
});
