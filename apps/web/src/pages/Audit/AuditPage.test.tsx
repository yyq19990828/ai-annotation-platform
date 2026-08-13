/**
 * v0.9.14 · AuditPage 单测 — 多维筛选 + 分页 + 导出 + 追溯清除主路径.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseAuditLogs = vi.fn();
const mockUseAuditMonthlySummary = vi.fn();
const mockUseUsers = vi.fn();
const mockExport = vi.fn();
const mockPushToast = vi.fn();
const mockRefetch = vi.fn();
const mockSummaryRefetch = vi.fn();

vi.mock("@/hooks/useAudit", () => ({
  useAuditLogs: (...args: unknown[]) => mockUseAuditLogs(...args),
  useAuditMonthlySummary: (...args: unknown[]) => mockUseAuditMonthlySummary(...args),
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
    mockSummaryRefetch.mockReset();
    mockUseUsers.mockReturnValue({ data: [] });
    mockUseAuditLogs.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isFetching: false,
      refetch: mockRefetch,
    });
    mockUseAuditMonthlySummary.mockReturnValue({
      data: {
        month: "2026-08",
        timezone: "UTC",
        materialized_through: "2026-08-12",
        totals: { event_count: 0, error_count: 0, action_kind_count: 0 },
        daily: [],
        top_actions: [],
        target_types: [],
        actor_roles: [],
      },
      isLoading: false,
      isError: false,
      refetch: mockSummaryRefetch,
    });
  });

  it("空数据 → 显示总数 0 + 第 1/1 页", () => {
    renderUI();
    expect(screen.getByText(/共 0 条/)).toBeInTheDocument();
    expect(screen.getByText(/第 1 \/ 1 页/)).toBeInTheDocument();
  });

  it("默认仅业务事件 → 后端查询带 business_only", () => {
    renderUI();
    const calls = mockUseAuditLogs.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.business_only).toBe(true);
    const summaryCalls = mockUseAuditMonthlySummary.mock.calls;
    expect(summaryCalls[summaryCalls.length - 1]?.[1]).toBe(true);
  });

  it("月度概览显示 KPI 与物化覆盖日期", () => {
    mockUseAuditMonthlySummary.mockReturnValue({
      data: {
        month: "2026-08",
        timezone: "UTC",
        materialized_through: "2026-08-12",
        totals: { event_count: 1243, error_count: 17, action_kind_count: 26 },
        daily: [{ day: "2026-08-01", event_count: 1243, error_count: 17 }],
        top_actions: [{ key: "task.approve", event_count: 418 }],
        target_types: [{ key: "task", event_count: 900 }],
        actor_roles: [{ key: "reviewer", event_count: 640 }],
      },
      isLoading: false,
      isError: false,
      refetch: mockSummaryRefetch,
    });
    renderUI();
    expect(screen.getByText("1,243")).toBeInTheDocument();
    expect(screen.getByText(/历史聚合至 2026-08-12/)).toBeInTheDocument();
    expect(screen.getByText("质检员")).toBeInTheDocument();
  });

  it("Top action 按钮下钻到现有明细过滤", async () => {
    mockUseAuditMonthlySummary.mockReturnValue({
      data: {
        month: "2026-08",
        timezone: "UTC",
        materialized_through: null,
        totals: { event_count: 4, error_count: 0, action_kind_count: 1 },
        daily: [{ day: "2026-08-01", event_count: 4, error_count: 0 }],
        top_actions: [{ key: "task.approve", event_count: 4 }],
        target_types: [],
        actor_roles: [],
      },
      isLoading: false,
      isError: false,
      refetch: mockSummaryRefetch,
    });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /task\.approve.*4/ }));
    await waitFor(() => {
      const calls = mockUseAuditLogs.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      expect(lastCall.action).toBe("task.approve");
    });
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
    expect(mockExport.mock.calls[0][0]).toEqual(expect.objectContaining({ business_only: true }));
    expect(mockExport.mock.calls[0][1]).toBe("csv");
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" })),
    );
  });

  it("detail 键值输入框在键名为空时 disabled", () => {
    renderUI();
    const valueInput = screen.getByPlaceholderText(/detail 键值/) as HTMLInputElement;
    expect(valueInput.disabled).toBe(true);
    const keyInput = screen.getByPlaceholderText(/detail 键名/);
    fireEvent.change(keyInput, { target: { value: "role" } });
    expect((screen.getByPlaceholderText(/detail 键值/) as HTMLInputElement).disabled).toBe(false);
  });

  it("切换到全部事件 → 移除 business_only 查询参数", async () => {
    renderUI();
    fireEvent.change(screen.getByDisplayValue("仅业务事件"), {
      target: { value: "all" },
    });
    await waitFor(() => {
      const calls = mockUseAuditLogs.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.business_only).toBeUndefined();
      const summaryCalls = mockUseAuditMonthlySummary.mock.calls;
      expect(summaryCalls[summaryCalls.length - 1]?.[1]).toBe(false);
    });
  });

  it("URL 参数 actor_id → 进入追溯模式 + 显示操作人 badge", () => {
    mockUseUsers.mockReturnValue({
      data: [{ id: "u-actor", name: "Alice", email: "a@x.com" }],
    });
    renderUI("/audit?actor_id=u-actor");
    expect(screen.getByText(/追溯模式/)).toBeInTheDocument();
    // badge 文本 "操作人 Alice · a@x.com"; select option 同样含 "Alice", 用更精确匹配
    expect(
      screen.getByText((_, node) => Boolean(node?.textContent?.match(/^操作人 Alice/))),
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
