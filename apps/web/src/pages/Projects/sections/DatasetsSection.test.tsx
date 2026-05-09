/**
 * v0.9.14 · DatasetsSection 单测 — 项目-数据集关联视图.
 *
 * 覆盖: 加载态 / 空 linked / 已关联表渲染 / 「关联数据集」按钮 + modal 候选列表 / 取消关联
 * 弹窗触发 (实际 unlink mutation 链路较长, 本版只测 trigger 入口).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseProjectDatasets = vi.fn();
const mockUseDatasets = vi.fn();
const mockLinkMutate = vi.fn();
const mockUnlinkMutate = vi.fn();
const mockPushToast = vi.fn();
const mockPreviewUnlink = vi.fn();

vi.mock("@/hooks/useDatasets", () => ({
  useProjectDatasets: () => mockUseProjectDatasets(),
  useDatasets: () => mockUseDatasets(),
  useLinkProject: () => ({ mutate: mockLinkMutate, isPending: false }),
  useUnlinkProject: () => ({ mutate: mockUnlinkMutate, isPending: false }),
}));
vi.mock("@/api/datasets", () => ({
  datasetsApi: {
    previewUnlink: (...args: unknown[]) => mockPreviewUnlink(...args),
  },
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { DatasetsSection } from "./DatasetsSection";
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
      <DatasetsSection project={baseProject} />
    </MemoryRouter>,
  );
}

describe("DatasetsSection", () => {
  beforeEach(() => {
    mockLinkMutate.mockReset();
    mockUnlinkMutate.mockReset();
    mockPushToast.mockReset();
    mockPreviewUnlink.mockReset().mockResolvedValue({
      will_delete_tasks: 0,
      will_delete_annotations: 0,
      will_delete_batches: 0,
    });
    mockUseDatasets.mockReturnValue({ data: { items: [] } });
  });

  it("isLoading=true → 显示加载中", () => {
    mockUseProjectDatasets.mockReturnValue({ data: undefined, isLoading: true });
    renderUI();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("空 linked 列表 → 显示空提示", () => {
    mockUseProjectDatasets.mockReturnValue({ data: [], isLoading: false });
    renderUI();
    expect(screen.getByText(/尚未关联任何数据集/)).toBeInTheDocument();
  });

  it("已关联渲染表格 + 取消关联按钮", () => {
    mockUseProjectDatasets.mockReturnValue({
      data: [
        {
          id: "d1",
          display_id: "DS-1",
          name: "City Streets",
          data_type: "image",
          items_count: 1234,
          tasks_in_project: 200,
          linked_at: "2026-04-01T10:00:00Z",
        },
      ],
      isLoading: false,
    });
    renderUI();
    expect(screen.getByText("City Streets")).toBeInTheDocument();
    expect(screen.getByText("DS-1")).toBeInTheDocument();
    expect(screen.getByText("1234")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消关联/ })).toBeInTheDocument();
  });

  it("点击「关联数据集」打开 modal 显示候选", () => {
    mockUseProjectDatasets.mockReturnValue({ data: [], isLoading: false });
    mockUseDatasets.mockReturnValue({
      data: {
        items: [
          { id: "d2", name: "Foggy Coast", display_id: "DS-2", data_type: "image" },
        ],
      },
    });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /关联数据集/ }));
    expect(screen.getByText("Foggy Coast")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /确认关联/ })).toBeDisabled();
  });

  it("Modal 内点选候选 → 确认关联触发 link mutation", () => {
    mockUseProjectDatasets.mockReturnValue({ data: [], isLoading: false });
    mockUseDatasets.mockReturnValue({
      data: {
        items: [
          { id: "d2", name: "Foggy Coast", display_id: "DS-2", data_type: "image" },
        ],
      },
    });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /关联数据集/ }));
    fireEvent.click(screen.getByText("Foggy Coast"));
    fireEvent.click(screen.getByRole("button", { name: /确认关联/ }));
    expect(mockLinkMutate).toHaveBeenCalledTimes(1);
    expect(mockLinkMutate.mock.calls[0][0]).toBe("p1");
  });

  it("「关联数据集」按钮在无候选时 disabled", () => {
    mockUseProjectDatasets.mockReturnValue({
      data: [{ id: "d1", name: "X", display_id: "DS-X", data_type: "image", items_count: 0, tasks_in_project: 0, linked_at: null }],
      isLoading: false,
    });
    mockUseDatasets.mockReturnValue({
      data: { items: [{ id: "d1", name: "X", display_id: "DS-X", data_type: "image" }] },
    });
    renderUI();
    expect(screen.getByRole("button", { name: /关联数据集/ })).toBeDisabled();
  });

  it("点取消关联触发 preview API + 渲染 unlink modal", async () => {
    mockUseProjectDatasets.mockReturnValue({
      data: [
        {
          id: "d1",
          display_id: "DS-1",
          name: "City Streets",
          data_type: "image",
          items_count: 1234,
          tasks_in_project: 50,
          linked_at: "2026-04-01T10:00:00Z",
        },
      ],
      isLoading: false,
    });
    mockPreviewUnlink.mockResolvedValueOnce({
      will_delete_tasks: 50,
      will_delete_annotations: 30,
      will_delete_batches: 2,
    });
    renderUI();
    fireEvent.click(screen.getByRole("button", { name: /取消关联/ }));
    expect(mockPreviewUnlink).toHaveBeenCalledWith("d1", "p1");
    // dangerous 路径下 modal 渲染输入框 + 数据集名 placeholder
    await waitFor(() =>
      expect(screen.getByPlaceholderText("City Streets")).toBeInTheDocument(),
    );
  });
});
