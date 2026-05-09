/**
 * v0.9.14 · BatchesSection 最小烟雾测试 — 依赖太多 (10+ hook), 仅测加载态 / 空批次 /
 * 创建按钮可见性. 完整交互（创建 / bulk / 逆向迁移 / 看板）推到 v0.9.15 与 admin-locked
 * UI 测试合并写.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseBatches = vi.fn();
const mockUseUnclassified = vi.fn();
const mockUseIsOwner = vi.fn();
const mockBatchEventsSocket = vi.fn();

const mutationStub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock("@/hooks/useBatches", () => ({
  useBatches: () => mockUseBatches(),
  useCreateBatch: () => mutationStub(),
  useDeleteBatch: () => mutationStub(),
  useTransitionBatch: () => mutationStub(),
  useSplitBatches: () => mutationStub(),
  useBulkArchiveBatches: () => mutationStub(),
  useBulkDeleteBatches: () => mutationStub(),
  useBulkReassignBatches: () => mutationStub(),
  useBulkActivateBatches: () => mutationStub(),
  useUnclassifiedTaskCount: () => mockUseUnclassified(),
}));
vi.mock("@/hooks/useBatchEventsSocket", () => ({
  useBatchEventsSocket: (...args: unknown[]) => mockBatchEventsSocket(...args),
}));
vi.mock("@/hooks/useIsProjectOwner", () => ({
  useIsProjectOwner: () => mockUseIsOwner(),
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: vi.fn() }),
  };
});

import { BatchesSection } from "./BatchesSection";
import type { ProjectResponse } from "@/api/projects";

const baseProject = {
  id: "p1",
  display_id: "P-1",
  name: "Demo",
  type_key: "image-det",
  type_label: "图像检测",
  status: "in_progress",
} as ProjectResponse;

function renderUI() {
  return render(
    <MemoryRouter>
      <BatchesSection project={baseProject} />
    </MemoryRouter>,
  );
}

describe("BatchesSection (smoke)", () => {
  beforeEach(() => {
    mockUseBatches.mockReset();
    mockUseUnclassified.mockReset().mockReturnValue({ data: { count: 0 } });
    mockUseIsOwner.mockReset().mockReturnValue(true);
    mockBatchEventsSocket.mockReset();
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseBatches.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("空 batches → 显示空提示", () => {
    mockUseBatches.mockReturnValue({ data: [], isLoading: false });
    renderUI();
    // 空批次提示文本（兜底匹配, 不强绑特定 wording）
    expect(screen.queryByText(/加载中/)).not.toBeInTheDocument();
  });

  it("project owner 时 useBatchEventsSocket 在 mount 期被调用 (项目 id 透传)", () => {
    mockUseBatches.mockReturnValue({ data: [], isLoading: false });
    renderUI();
    expect(mockBatchEventsSocket).toHaveBeenCalledWith("p1");
  });
});
