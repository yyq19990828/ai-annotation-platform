/**
 * StoragePage 单测 — 存储桶/数据集/视频资产失败 主路径.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockPushToast = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockRetryMutate = vi.fn();

// --- useQueryClient ---
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<any>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

// --- useStorage ---
const mockUseStorageBuckets = vi.fn();
const mockUseVideoAssetFailures = vi.fn();
vi.mock("@/hooks/useStorage", () => ({
  useStorageBuckets: () => mockUseStorageBuckets(),
  useVideoAssetFailures: () => mockUseVideoAssetFailures(),
  useRetryVideoAsset: () => ({
    mutate: mockRetryMutate,
    isPending: false,
  }),
}));

// --- useDatasets ---
const mockUseDatasets = vi.fn();
vi.mock("@/hooks/useDatasets", () => ({
  useDatasets: () => mockUseDatasets(),
}));

// --- toast ---
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { StoragePage } from "./StoragePage";

const SAMPLE_BUCKET = {
  name: "datasets",
  role: "datasets",
  status: "ok",
  total_size_bytes: 1024 * 1024 * 50,
  object_count: 1234,
  error: null,
};

const SAMPLE_BUCKET_ERROR = {
  name: "annotations",
  role: "annotations",
  status: "error",
  total_size_bytes: 0,
  object_count: 0,
  error: "connection refused",
};

const SAMPLE_DATASET = {
  id: "ds1",
  display_id: "DS-1",
  name: "City Scenes",
  data_type: "image",
  file_count: 500,
  project_count: 2,
  total_size: 1024 * 1024 * 20,
};

const SAMPLE_VIDEO_FAILURE = {
  asset_key: "vaf-1",
  asset_type: "probe" as const,
  dataset_item_id: "di1",
  file_name: "video.mp4",
  chunk_id: null,
  frame_index: null,
  width: null,
  format: null,
  error: "timeout",
  updated_at: "2026-05-01T10:00:00Z",
  project_name: "Video Project",
  task_display_id: "T-001",
};

function renderUI() {
  return render(
    <MemoryRouter>
      <StoragePage />
    </MemoryRouter>,
  );
}

describe("StoragePage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockInvalidateQueries.mockReset();
    mockRetryMutate.mockReset();
    mockUseStorageBuckets.mockReturnValue({
      data: {
        items: [SAMPLE_BUCKET],
        total_size_bytes: SAMPLE_BUCKET.total_size_bytes,
        total_object_count: SAMPLE_BUCKET.object_count,
      },
      isError: false,
    });
    mockUseDatasets.mockReturnValue({ data: { items: [], total: 0 } });
    mockUseVideoAssetFailures.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isError: false,
    });
  });

  it("渲染页面标题与存储桶名", () => {
    renderUI();
    expect(screen.getByText("存储管理")).toBeInTheDocument();
    expect(screen.getByText("datasets")).toBeInTheDocument();
  });

  it("存储桶正常 → 显示「已连接」badge", () => {
    renderUI();
    expect(screen.getByText("已连接")).toBeInTheDocument();
  });

  it("存储桶 error → 显示「连接失败」badge", () => {
    mockUseStorageBuckets.mockReturnValue({
      data: {
        items: [SAMPLE_BUCKET_ERROR],
        total_size_bytes: 0,
        total_object_count: 0,
      },
      isError: false,
    });
    renderUI();
    expect(screen.getByText("连接失败")).toBeInTheDocument();
  });

  it("bucketsData undefined + isError=true → 显示「无法连接存储后端」", () => {
    mockUseStorageBuckets.mockReturnValue({ data: undefined, isError: true });
    renderUI();
    expect(screen.getByText("无法连接存储后端")).toBeInTheDocument();
  });

  it("数据集列表有数据 → 渲染数据集行", () => {
    mockUseDatasets.mockReturnValue({ data: { items: [SAMPLE_DATASET], total: 1 } });
    renderUI();
    expect(screen.getByText("City Scenes")).toBeInTheDocument();
    expect(screen.getByText("DS-1")).toBeInTheDocument();
  });

  it("数据集列表空态 → 显示「暂无数据集」", () => {
    renderUI();
    expect(screen.getByText("暂无数据集")).toBeInTheDocument();
  });

  it("视频资产失败列表有数据 → 渲染失败行 + 重试按钮", () => {
    mockUseVideoAssetFailures.mockReturnValue({
      data: { items: [SAMPLE_VIDEO_FAILURE], total: 1 },
      isLoading: false,
      isError: false,
    });
    renderUI();
    expect(screen.getAllByText("video.mp4").length).toBeGreaterThan(0);
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("视频资产失败为空 → 显示「暂无视频资产失败」", () => {
    renderUI();
    expect(screen.getByText("暂无视频资产失败")).toBeInTheDocument();
  });

  it("点击重试按钮 → 调用 retry.mutate", () => {
    mockUseVideoAssetFailures.mockReturnValue({
      data: { items: [SAMPLE_VIDEO_FAILURE], total: 1 },
      isLoading: false,
      isError: false,
    });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(mockRetryMutate).toHaveBeenCalledTimes(1);
    expect(mockRetryMutate.mock.calls[0][0]).toMatchObject({
      asset_type: "probe",
      dataset_item_id: "di1",
    });
  });

  it("点击「刷新状态」→ invalidateQueries 被调用", () => {
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /刷新状态/ }));
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("视频资产加载中 → 显示加载态文字", () => {
    mockUseVideoAssetFailures.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });
});
