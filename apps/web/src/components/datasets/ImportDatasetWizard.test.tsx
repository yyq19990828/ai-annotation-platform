/**
 * ImportDatasetWizard 单测
 * 覆盖: 初始渲染 / step1 校验 / step1→2 推进 / skipCreate 直接到 step2 /
 *       step2 文件模式 / step2 ZIP 模式 / 上传触发 mutation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockCreateDatasetMutateAsync = vi.fn();
const mockCreateDatasetReset = vi.fn();
const mockImportFromConnectionMutateAsync = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/hooks/useDatasets", () => ({
  useCreateDataset: () => ({
    mutateAsync: mockCreateDatasetMutateAsync,
    reset: mockCreateDatasetReset,
    isPending: false,
  }),
  useImportFromConnection: () => ({
    mutateAsync: mockImportFromConnectionMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/api/datasets", () => ({
  datasetsApi: {
    uploadInit: vi.fn().mockResolvedValue({ upload_url: "http://fake/upload", item_id: "item1" }),
    uploadComplete: vi.fn().mockResolvedValue(undefined),
    uploadZip: vi.fn().mockResolvedValue({ added: 5, skipped: 0, errors: [], total_in_zip: 5 }),
  },
}));

vi.mock("@/utils/uploadQueue", () => ({
  putWithProgress: vi.fn().mockResolvedValue(undefined),
  runUploadQueue: vi.fn().mockImplementation(async (_tasks: unknown[], map: Map<string, { status: string; progress: number }>, opts: { onUpdate?: () => void }) => {
    for (const [k, v] of map.entries()) {
      v.status = "done";
      v.progress = 100;
      map.set(k, v);
    }
    opts?.onUpdate?.();
  }),
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { ImportDatasetWizard } from "./ImportDatasetWizard";

function renderUI(props: Partial<React.ComponentProps<typeof ImportDatasetWizard>> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <ImportDatasetWizard {...defaults} {...props} />
    </MemoryRouter>,
  );
}

describe("ImportDatasetWizard", () => {
  beforeEach(() => {
    mockCreateDatasetMutateAsync.mockReset().mockResolvedValue({ id: "ds-new", name: "Test DS" });
    mockCreateDatasetReset.mockReset();
    mockImportFromConnectionMutateAsync.mockReset();
    mockPushToast.mockReset();
  });

  it("初始渲染: step1 显示「基本信息」+ 「下一步」禁用", () => {
    renderUI();
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/商品检测训练集/)).toBeInTheDocument();
    const nextBtn = screen.getByRole("button", { name: /下一步/ });
    expect(nextBtn).toBeDisabled();
  });

  it("step1 名称输入不足 2 字符时「下一步」仍禁用", () => {
    renderUI();
    fireEvent.change(screen.getByPlaceholderText(/商品检测训练集/), {
      target: { value: "A" },
    });
    expect(screen.getByRole("button", { name: /下一步/ })).toBeDisabled();
  });

  it("step1 填入有效名称后「下一步」启用 + 点击进入 step2", () => {
    renderUI();
    fireEvent.change(screen.getByPlaceholderText(/商品检测训练集/), {
      target: { value: "合法数据集名称" },
    });
    const nextBtn = screen.getByRole("button", { name: /下一步/ });
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);
    expect(screen.getByText("选择来源")).toBeInTheDocument();
    // step2 标题: 拖拽文件提示
    expect(screen.getByText(/拖拽文件到此处/)).toBeInTheDocument();
  });

  it("skipCreate (datasetId 给定) 直接显示 step2，不显示「下一步」中的名称字段", () => {
    renderUI({ datasetId: "existing-ds", datasetName: "已有数据集" });
    // step2 相关文案出现
    expect(screen.getByText(/拖拽文件到此处/)).toBeInTheDocument();
    // step1 名称输入框不存在
    expect(screen.queryByPlaceholderText(/商品检测训练集/)).not.toBeInTheDocument();
  });

  it("step2 文件模式: 未选文件时「开始上传」禁用", () => {
    renderUI({ datasetId: "ds1" });
    expect(screen.getByRole("button", { name: /开始上传/ })).toBeDisabled();
  });

  it("step2 切换到 ZIP 模式显示 ZIP 相关文案", () => {
    renderUI({ datasetId: "ds1" });
    const zipTab = screen.getByRole("button", { name: /ZIP 包/ });
    fireEvent.click(zipTab);
    expect(screen.getByText(/拖入或/)).toBeInTheDocument();
    expect(screen.getByText(/整包 ≤ 200MB/)).toBeInTheDocument();
  });

  it("step1 → step2 → 模拟添加文件后「开始上传」启用 + 触发 createDataset", async () => {
    renderUI();
    // 填名称进入 step2
    fireEvent.change(screen.getByPlaceholderText(/商品检测训练集/), {
      target: { value: "新建集合" },
    });
    fireEvent.click(screen.getByRole("button", { name: /下一步/ }));

    // 找到隐藏的 file input 并模拟上传文件
    const fileInput = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    const fakeFile = new File(["content"], "img.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(screen.getByText(/已选 1 个文件/)).toBeInTheDocument(),
    );

    const uploadBtn = screen.getByRole("button", { name: /开始上传/ });
    expect(uploadBtn).not.toBeDisabled();
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(mockCreateDatasetMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it("open=false 时 wizard 不渲染内容", () => {
    renderUI({ open: false });
    expect(screen.queryByText("基本信息")).not.toBeInTheDocument();
  });
});
