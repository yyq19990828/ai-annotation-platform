/**
 * DatasetsPage 单测 — 加载态 / 空态 / 正常渲染 / 新建交互 / 搜索过滤.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseDatasets = vi.fn();
const mockUseCreateDataset = vi.fn();
const mockUseDatasetItems = vi.fn();
const mockUseDatasetProjects = vi.fn();
const mockUseProjects = vi.fn();
const mockUseUnlinkProject = vi.fn();
const mockUseLinkProject = vi.fn();
const mockUseScanDatasetItems = vi.fn();
const mockUseBackfillDimensions = vi.fn();
const mockUseBackfillMedia = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/hooks/useDatasets", () => ({
  useDatasets: (...args: unknown[]) => mockUseDatasets(...args),
  useCreateDataset: () => mockUseCreateDataset(),
  useDatasetItems: () => mockUseDatasetItems(),
  useDatasetProjects: () => mockUseDatasetProjects(),
  useUnlinkProject: () => mockUseUnlinkProject(),
  useLinkProject: () => mockUseLinkProject(),
  useScanDatasetItems: () => mockUseScanDatasetItems(),
  useBackfillDimensions: () => mockUseBackfillDimensions(),
  useBackfillMedia: () => mockUseBackfillMedia(),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock("@/api/datasets", () => ({
  datasetsApi: {
    previewUnlink: vi.fn().mockResolvedValue({ will_delete_tasks: 0, will_delete_annotations: 0, will_delete_batches: 0 }),
  },
}));

vi.mock("@/components/datasets/ImportDatasetWizard", () => ({
  ImportDatasetWizard: ({ open }: any) => (open ? <div data-testid="import-wizard" /> : null),
}));

vi.mock("@/components/connections/StorageConnectionsPanel", () => ({
  StorageConnectionsPanel: () => <div data-testid="storage-connections-panel" />,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<any>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { DatasetsPage } from "./DatasetsPage";

const idleMutation = { mutate: vi.fn(), isPending: false };

function renderUI() {
  return render(
    <MemoryRouter>
      <DatasetsPage />
    </MemoryRouter>,
  );
}

describe("DatasetsPage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockUseCreateDataset.mockReturnValue(idleMutation);
    mockUseDatasetItems.mockReturnValue({ data: undefined, isLoading: false });
    mockUseDatasetProjects.mockReturnValue({ data: [] });
    mockUseProjects.mockReturnValue({ data: [] });
    mockUseUnlinkProject.mockReturnValue(idleMutation);
    mockUseLinkProject.mockReturnValue(idleMutation);
    mockUseScanDatasetItems.mockReturnValue(idleMutation);
    mockUseBackfillDimensions.mockReturnValue(idleMutation);
    mockUseBackfillMedia.mockReturnValue(idleMutation);
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseDatasets.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getAllByText("加载中...").length).toBeGreaterThan(0);
  });

  it("空数据 → 渲染页面标题 + 暂无数据集文案", () => {
    mockUseDatasets.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderUI();
    expect(screen.getAllByText("数据集").length).toBeGreaterThan(0);
    expect(screen.getByText(/暂无数据集/)).toBeInTheDocument();
  });

  it("有数据 → 渲染数据集行 + stat 卡片", () => {
    mockUseDatasets.mockReturnValue({
      data: {
        items: [
          {
            id: "ds1",
            display_id: "D-1",
            name: "测试数据集",
            description: "描述",
            data_type: "image",
            file_count: 42,
            project_count: 2,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        total: 1,
      },
      isLoading: false,
    });
    renderUI();
    expect(screen.getByText("测试数据集")).toBeInTheDocument();
    expect(screen.getByText(/D-1/)).toBeInTheDocument();
    // stat cards
    expect(screen.getByText("数据集总数")).toBeInTheDocument();
    expect(screen.getByText("文件总量")).toBeInTheDocument();
  });

  it("点击「新建数据集」按钮 → 显示创建表单", () => {
    mockUseDatasets.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderUI();
    expect(screen.queryByText("新建数据集", { selector: "h3" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新建数据集/ }));
    expect(screen.getByText("新建数据集", { selector: "h3" })).toBeInTheDocument();
  });

  it("搜索框输入后 query 传入 useDatasets", () => {
    mockUseDatasets.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderUI();
    const input = screen.getByPlaceholderText("搜索数据集...");
    fireEvent.change(input, { target: { value: "my-ds" } });
    // 最后一次调用应包含 search 参数
    const lastCall = mockUseDatasets.mock.calls[mockUseDatasets.mock.calls.length - 1][0];
    expect(lastCall.search).toBe("my-ds");
  });

  it("搜索无结果 → 显示「没有匹配的数据集」", () => {
    mockUseDatasets.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderUI();
    const input = screen.getByPlaceholderText("搜索数据集...");
    fireEvent.change(input, { target: { value: "不存在" } });
    // 触发重渲染：mock 保持空结果
    expect(screen.getByText("没有匹配的数据集")).toBeInTheDocument();
  });
});
