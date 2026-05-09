/**
 * v0.9.14 · AuditPage 单测 — 多维筛选 + 分页 + 导出 + 追溯清除主路径.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseAuditLogs = vi.fn();
const mockUseUsers = vi.fn();
const mockExport = vi.fn();
const mockPushToast = vi.fn();
const mockRefetch = vi.fn();

vi.mock("@/hooks/useAudit", () => ({
  useAuditLogs: (...args: unknown[]) => mockUseAuditLogs(...args),
}));
vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => mockUseUsers(),
}));
vi.mock("@/api/audit", () => ({
  auditApi: {
    export: (...args: unknown[]) => mockExport(...args),
  },
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { AuditPage } from "./AuditPage";

function renderUI(initialPath = "/audit") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuditPage />
    </MemoryRouter>,
  );
}

describe("AuditPage", () => {
  beforeEach(() => {
    mockExport.mockReset().mockResolvedValue(undefined);
    mockPushToast.mockReset();
    mockRefetch.mockReset();
    mockUseUsers.mockReturnValue({ data: [] });
    mockUseAuditLogs.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isFetching: false,
      refetch: mockRefetch,
    });
  });

  it("空数据 → 显示总数 0 + 第 1/1 页", () => {
    renderUI();
    expect(screen.getByText(/共 0 条/)).toBeInTheDocument();
    expect(screen.getByText(/第 1 \/ 1 页/)).toBeInTheDocument();
  });

  it("有数据 → 总数显示 1 条", () => {
    mockUseAuditLogs.mockReturnValue({
      data: {
        total: 1,
        items: [
          {
            id: "a1",
            actor_id: "u1",
            actor_name: "alice",
            action: "project.create",
            target_type: "project",
            target_id: "p1",
            ip: "127.0.0.1",
            status_code: 200,
            request_id: "r1",
            created_at: "2026-05-09T00:00:00Z",
            detail_json: {},
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: mockRefetch,
    });
    renderUI();
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument();
  });

  it("点 CSV 导出按钮 → 调用 auditApi.export + toast", async () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
    expect(mockExport.mock.calls[0][1]).toBe("csv");
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success" }),
      ),
    );
  });

  it("detail 键值输入框在键名为空时 disabled", () => {
    renderUI();
    const valueInput = screen.getByPlaceholderText(
      /detail 键值/,
    ) as HTMLInputElement;
    expect(valueInput.disabled).toBe(true);
    const keyInput = screen.getByPlaceholderText(/detail 键名/);
    fireEvent.change(keyInput, { target: { value: "role" } });
    expect((screen.getByPlaceholderText(/detail 键值/) as HTMLInputElement).disabled).toBe(false);
  });

  it("URL 参数 actor_id → 进入追溯模式 + 显示操作人 badge", () => {
    mockUseUsers.mockReturnValue({
      data: [{ id: "u-actor", name: "Alice", email: "a@x.com" }],
    });
    renderUI("/audit?actor_id=u-actor");
    expect(screen.getByText(/追溯模式/)).toBeInTheDocument();
    // badge 文本 "操作人 Alice · a@x.com"; select option 同样含 "Alice", 用更精确匹配
    expect(
      screen.getByText((_, node) =>
        Boolean(node?.textContent?.match(/^操作人 Alice/)),
      ),
    ).toBeInTheDocument();
  });

  it("点刷新按钮 → 调用 refetch", () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("URL 参数 target_type → 筛选 select 同步", () => {
    renderUI("/audit?target_type=user");
    expect(mockUseAuditLogs).toHaveBeenCalled();
    const calls = mockUseAuditLogs.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.target_type).toBe("user");
  });
});
