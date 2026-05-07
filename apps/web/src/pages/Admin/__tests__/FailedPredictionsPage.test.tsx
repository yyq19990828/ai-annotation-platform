/**
 * v0.8.8 · FailedPredictionsPage 单测：dismiss / restore / include_dismissed toggle UI。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listMock = vi.fn();
const dismissMock = vi.fn();
const restoreMock = vi.fn();
const retryMock = vi.fn();

vi.mock("@/api/failed-predictions", () => ({
  failedPredictionsApi: {
    list: (page: number, pageSize: number, includeDismissed?: boolean) =>
      listMock(page, pageSize, includeDismissed),
    retry: (id: string) => retryMock(id),
    dismiss: (id: string) => dismissMock(id),
    restore: (id: string) => restoreMock(id),
  },
}));

// stub Toast — UI surface 测试无需真实弹窗
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: vi.fn(() => vi.fn()),
}));

import { FailedPredictionsPage } from "../FailedPredictionsPage";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const sampleItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "fp1",
  task_id: "t1",
  task_display_id: "T-1",
  project_id: "p1",
  project_name: "Demo",
  ml_backend_id: "b1",
  backend_name: "echo",
  model_version: "v1",
  error_type: "TIMEOUT",
  message: "boom",
  retry_count: 1,
  last_retry_at: null,
  dismissed_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  listMock.mockReset();
  dismissMock.mockReset();
  restoreMock.mockReset();
  retryMock.mockReset();
});

describe("FailedPredictionsPage", () => {
  it("默认调用 list(page=1, size=30, includeDismissed=false)", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem()],
      total: 1,
      page: 1,
      page_size: 30,
    });
    wrap(<FailedPredictionsPage />);
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(1, 30, false),
    );
    await screen.findByText("Demo");
  });

  it("勾选「显示已放弃」后再次 list 携带 includeDismissed=true", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem()],
      total: 1,
      page: 1,
      page_size: 30,
    });
    wrap(<FailedPredictionsPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const toggle = screen.getByTestId("toggle-include-dismissed").querySelector("input")!;
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(1, 30, true),
    );
  });

  it("普通行（dismissed_at=null）显示重试 + 放弃按钮", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem()],
      total: 1,
      page: 1,
      page_size: 30,
    });
    wrap(<FailedPredictionsPage />);
    await screen.findByTestId("retry-fp1");
    expect(screen.getByTestId("dismiss-fp1")).toBeInTheDocument();
    expect(screen.queryByTestId("restore-fp1")).toBeNull();
  });

  it("已 dismiss 行显示恢复按钮、不显示重试 / 放弃", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem({ dismissed_at: new Date().toISOString() })],
      total: 1,
      page: 1,
      page_size: 30,
    });
    wrap(<FailedPredictionsPage />);
    await screen.findByTestId("restore-fp1");
    expect(screen.queryByTestId("retry-fp1")).toBeNull();
    expect(screen.queryByTestId("dismiss-fp1")).toBeNull();
  });

  it("重试达到上限的行：disabled + 文案「已达上限」", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem({ retry_count: 3 })],
      total: 1,
      page: 1,
      page_size: 30,
    });
    wrap(<FailedPredictionsPage />);
    const btn = (await screen.findByTestId("retry-fp1")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("已达上限");
  });

  it("点击放弃 → confirm 后调用 dismiss API", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem()],
      total: 1,
      page: 1,
      page_size: 30,
    });
    dismissMock.mockResolvedValue({
      status: "dismissed",
      failed_id: "fp1",
      dismissed_at: new Date().toISOString(),
    });
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);

    wrap(<FailedPredictionsPage />);
    fireEvent.click(await screen.findByTestId("dismiss-fp1"));
    await waitFor(() => expect(dismissMock).toHaveBeenCalledWith("fp1"));
    confirmSpy.mockRestore();
  });

  it("用户在 confirm 中选取消时不调用 dismiss API", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem()],
      total: 1,
      page: 1,
      page_size: 30,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    wrap(<FailedPredictionsPage />);
    fireEvent.click(await screen.findByTestId("dismiss-fp1"));
    await Promise.resolve();
    expect(dismissMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("已 dismiss 行点击恢复 → 调用 restore API", async () => {
    listMock.mockResolvedValue({
      items: [sampleItem({ dismissed_at: new Date().toISOString() })],
      total: 1,
      page: 1,
      page_size: 30,
    });
    restoreMock.mockResolvedValue({
      status: "restored",
      failed_id: "fp1",
      dismissed_at: null,
    });
    wrap(<FailedPredictionsPage />);
    fireEvent.click(await screen.findByTestId("restore-fp1"));
    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith("fp1"));
  });

  it("空数据时渲染「暂无失败预测」", async () => {
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 30 });
    wrap(<FailedPredictionsPage />);
    await screen.findByText("暂无失败预测");
  });
});
