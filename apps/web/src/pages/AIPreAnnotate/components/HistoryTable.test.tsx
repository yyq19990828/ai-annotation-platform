/**
 * v0.9.12 · HistoryTable 多选 + 批量重激活/重置测试 (BUG B-16).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockBulkClear = vi.fn();
vi.mock("@/hooks/useBulkPreannotateActions", () => ({
  useBulkPreannotateClear: () => ({
    mutateAsync: mockBulkClear,
    isPending: false,
    error: null,
  }),
}));

import { HistoryTable } from "./HistoryTable";
import type { PreannotateQueueItem } from "@/api/adminPreannotate";

function makeItem(overrides: Partial<PreannotateQueueItem> = {}): PreannotateQueueItem {
  return {
    batch_id: "b1",
    batch_name: "B1",
    batch_status: "pre_annotated",
    project_id: "p1",
    project_name: "Proj1",
    project_display_id: "P-1",
    total_tasks: 10,
    prediction_count: 8,
    failed_count: 0,
    last_run_at: new Date().toISOString(),
    can_retry: false,
    ...overrides,
  };
}

function renderUI(items: PreannotateQueueItem[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HistoryTable items={items} isLoading={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HistoryTable v0.9.12 多选", () => {
  beforeEach(() => {
    mockBulkClear.mockReset();
  });

  it("空选中时不渲染浮窗", () => {
    renderUI([makeItem()]);
    expect(screen.queryByText(/已选/)).toBeNull();
  });

  it("勾选行后浮窗渲染 + 显示计数", () => {
    renderUI([makeItem({ batch_id: "b1" }), makeItem({ batch_id: "b2", batch_name: "B2" })]);
    const rowChecks = screen.getAllByRole("checkbox", { name: /选择/ });
    fireEvent.click(rowChecks[0]);
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();
    fireEvent.click(rowChecks[1]);
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
  });

  it("全选 checkbox 切换当前页所有 batch", () => {
    renderUI([makeItem({ batch_id: "b1" }), makeItem({ batch_id: "b2", batch_name: "B2" })]);
    const headerCheck = screen.getByRole("checkbox", { name: /全选/ });
    fireEvent.click(headerCheck);
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    fireEvent.click(headerCheck);
    expect(screen.queryByText(/已选/)).toBeNull();
  });

  it("批量重激活: reason ≥10 字提交后调 bulkClear(predictions_only)", async () => {
    mockBulkClear.mockResolvedValueOnce({ succeeded: ["b1"], skipped: [], failed: [] });
    renderUI([makeItem({ batch_id: "b1" })]);
    fireEvent.click(screen.getByRole("checkbox", { name: /选择/ }));
    fireEvent.click(screen.getByRole("button", { name: /批量重激活/ }));

    const textarea = screen.getByPlaceholderText(/批次配置错误/);
    fireEvent.change(textarea, { target: { value: "测试批量重激活原因 OK" } });

    const confirmBtn = screen.getByRole("button", { name: "确认" });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockBulkClear).toHaveBeenCalledWith({
        batch_ids: ["b1"],
        mode: "predictions_only",
        reason: "测试批量重激活原因 OK",
      });
    });
  });

  it("reason < 10 字时确认按钮 disabled", () => {
    renderUI([makeItem({ batch_id: "b1" })]);
    fireEvent.click(screen.getByRole("checkbox", { name: /选择/ }));
    fireEvent.click(screen.getByRole("button", { name: /批量重激活/ }));
    const textarea = screen.getByPlaceholderText(/批次配置错误/);
    fireEvent.change(textarea, { target: { value: "短" } });
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
  });

  it("部分失败时弹结果视图保留 modal 展示 failed 详情", async () => {
    mockBulkClear.mockResolvedValueOnce({
      succeeded: ["b1"],
      skipped: [],
      failed: [{ batch_id: "b2", reason: "RuntimeError: boom" }],
    });
    renderUI([makeItem({ batch_id: "b1" }), makeItem({ batch_id: "b2", batch_name: "B2" })]);
    const headerCheck = screen.getByRole("checkbox", { name: /全选/ });
    fireEvent.click(headerCheck);
    fireEvent.click(screen.getByRole("button", { name: /批量重激活/ }));
    fireEvent.change(screen.getByPlaceholderText(/批次配置错误/), {
      target: { value: "重激活原因示例文字 OK" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    // 等结果视图渲染 (data-testid="bulk-result")
    const resultView = await screen.findByTestId("bulk-result", {}, { timeout: 2000 });
    expect(resultView).toBeInTheDocument();
    expect(resultView.textContent ?? "").toContain("RuntimeError: boom");
  });
});
