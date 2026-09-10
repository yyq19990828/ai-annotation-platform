/**
 * AnnotationGuideSection 单测 — 共享编辑器接入 / 保存 mutation 主路径.
 *
 * 覆盖:
 * - 渲染共享编辑器 + 加载初值
 * - 空指引显式插入 starter 模板
 * - 修改 markdown → "保存" 触发 useUpdateProject.mutateAsync({ annotation_guide })
 * - 已上传 guide_assets 列表渲染 + 删除按钮调 useGuideAssets.deleteAsset
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockMutationOwners: string[] = [];
const mockPushToast = vi.fn();
const mockUploadAsset = vi.fn();
const mockDeleteAsset = vi.fn();
const mockSignAsset = vi.fn().mockResolvedValue("http://signed/x");

vi.mock("@/hooks/useProjects", () => ({
  useUpdateProject: (projectId: string) => ({
    mutateAsync: (payload: unknown) => {
      mockMutationOwners.push(projectId);
      return mockMutateAsync(payload);
    },
    isPending: false,
  }),
}));
vi.mock("@/hooks/useGuideAssets", () => ({
  useGuideAssets: () => ({
    uploadAsset: mockUploadAsset,
    deleteAsset: mockDeleteAsset,
    signAsset: mockSignAsset,
  }),
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: { push: typeof mockPushToast }) => T) =>
      sel({ push: mockPushToast }),
  };
});
// 避免在 jsdom 加载 CodeMirror; 用简单 textarea 模拟编辑器交互
vi.mock("@/components/markdown/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    onBlur,
  }: {
    value: string;
    onChange: (v: string) => void;
    onBlur?: () => void;
  }) => (
    <textarea
      data-testid="markdown-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  ),
}));

import { AnnotationGuideSection } from "./AnnotationGuideSection";
import type { ProjectResponse } from "@/api/projects";

function makeProject(
  overrides: Partial<ProjectResponse> & {
    annotation_guide?: string | null;
    guide_assets?: Array<Record<string, unknown>>;
  } = {},
): ProjectResponse {
  return {
    id: "p-guide",
    display_id: "P-1",
    name: "Guide Demo",
    type_key: "image-det",
    type_label: "图像检测",
    owner_id: "u1",
    status: "in_progress",
    classes: [],
    classes_config: {},
    attribute_schema: { fields: [] },
    ai_enabled: false,
    ml_backend_id: null,
    member_count: 0,
    iou_dedup_threshold: 0.7,
    box_threshold: 0.35,
    text_threshold: 0.25,
    rendering_config: {},
    total_tasks: 0,
    completed_tasks: 0,
    review_tasks: 0,
    due_date: null,
    created_at: "2026-05-18T00:00:00Z",
    updated_at: "2026-05-18T00:00:00Z",
    ...overrides,
  } as unknown as ProjectResponse;
}

describe("AnnotationGuideSection", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockMutateAsync.mockReset().mockResolvedValue({});
    mockMutationOwners.length = 0;
    mockPushToast.mockReset();
    mockUploadAsset.mockReset();
    mockDeleteAsset.mockReset().mockResolvedValue(undefined);
    mockSignAsset.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("加载初值并渲染共享编辑器", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "# 初始指引" })} />);
    const editor = await screen.findByTestId("markdown-editor");
    expect((editor as HTMLTextAreaElement).value).toBe("# 初始指引");
    expect(screen.getByRole("heading", { level: 3, name: "标注指引" })).toBeInTheDocument();
  });

  it("修改 markdown 后失焦 → mutation 携带 annotation_guide", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "" })} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# 新指引\n第一条" } });
    fireEvent.blur(editor);
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# 新指引\n第一条" });
      expect(screen.getByTestId("guide-save-status")).toHaveTextContent("已保存");
    });
  });

  it("内容未变化失焦 → 不触发 mutation", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "# 初始" })} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    fireEvent.blur(editor);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("旧项目保存未完成时切换项目不会写入新项目，且新项目可独立保存", async () => {
    let resolveA: (() => void) | undefined;
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveA = resolve;
        }),
    );

    const { rerender } = render(
      <AnnotationGuideSection project={makeProject({ id: "p-a", annotation_guide: "# A" })} />,
    );
    const editorA = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    fireEvent.change(editorA, { target: { value: "# A 修改" } });
    fireEvent.blur(editorA);
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# A 修改" }),
    );

    rerender(
      <AnnotationGuideSection project={makeProject({ id: "p-b", annotation_guide: "# B" })} />,
    );
    const editorB = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    fireEvent.blur(editorB);
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));

    fireEvent.change(editorB, { target: { value: "# B 修改" } });
    fireEvent.blur(editorB);
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# B 修改" }),
    );
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);

    resolveA?.();
  });

  it("空指引仅在显式操作后插入 starter 模板", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "" })} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    expect(editor.value).toBe("");
    fireEvent.click(screen.getByTestId("guide-starter"));
    expect(editor.value).toContain("## 类别定义");
  });

  it("guide_assets 列表渲染 + 删除按钮调 deleteAsset", async () => {
    const asset = {
      key: "projects/p-guide/guide/xxx-x.png",
      original_name: "screenshot.png",
      content_type: "image/png",
      size: 12_345,
      uploaded_at: "2026-05-18T01:00:00Z",
    };
    render(
      <AnnotationGuideSection
        project={makeProject({ annotation_guide: "", guide_assets: [asset] })}
      />,
    );
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await waitFor(() => {
      expect(mockDeleteAsset).toHaveBeenCalledWith(asset.key);
    });
  });

  it("停止编辑 1000ms 后自动保存并合并连续输入", async () => {
    const { unmount } = render(<AnnotationGuideSection project={makeProject()} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "# 第一版" } });
    expect(screen.getByTestId("guide-save-status")).toHaveTextContent("等待自动保存");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: "# 最终版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# 最终版" });
    expect(screen.getByTestId("guide-save-status")).toHaveTextContent("已保存");
    unmount();
  });

  it("立即保存会取消自动计时器并避免重复请求", async () => {
    const { unmount } = render(<AnnotationGuideSection project={makeProject()} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "# 手动保存" } });
    fireEvent.click(screen.getByTestId("guide-save"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("自动保存失败后保留草稿，且只有重试或新编辑会再次请求", async () => {
    mockMutateAsync
      .mockReset()
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({});
    const { unmount } = render(<AnnotationGuideSection project={makeProject()} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "# 待重试" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("guide-save-status")).toHaveTextContent("保存失败：网络中断");
    expect(mockPushToast).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("guide-save"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("guide-save-status")).toHaveTextContent("已保存");
    unmount();
  });

  it("串行保存时旧响应不会绕过新稿的自动保存计时器", async () => {
    const pending: Array<{
      payload: { annotation_guide: string };
      resolve: () => void;
    }> = [];
    mockMutateAsync.mockImplementation((payload: { annotation_guide: string }) => {
      return new Promise<void>((resolve) => pending.push({ payload, resolve }));
    });
    const { unmount } = render(<AnnotationGuideSection project={makeProject()} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "A" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pending.map((item) => item.payload.annotation_guide)).toEqual(["A"]);

    fireEvent.change(editor, { target: { value: "B" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    pending[0].resolve();
    await act(async () => undefined);
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(pending.map((item) => item.payload.annotation_guide)).toEqual(["A", "B"]);

    fireEvent.change(editor, { target: { value: "A" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    pending[1].resolve();
    await act(async () => undefined);
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(pending.map((item) => item.payload.annotation_guide)).toEqual(["A", "B", "A"]);
    pending[2].resolve();
    await act(async () => undefined);
    unmount();
  });

  it("保存 B 时撤销回已确认的 A 仍拦截离页，A 保存完成后解除", async () => {
    const pending: Array<{
      payload: { annotation_guide: string };
      resolve: () => void;
    }> = [];
    mockMutateAsync.mockImplementation((payload: { annotation_guide: string }) => {
      return new Promise<void>((resolve) => pending.push({ payload, resolve }));
    });
    const { unmount } = render(
      <AnnotationGuideSection project={makeProject({ annotation_guide: "A" })} />,
    );
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "B" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pending.map((item) => item.payload.annotation_guide)).toEqual(["B"]);

    fireEvent.change(editor, { target: { value: "A" } });
    const beforeUnloadWhileBIsActive = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(beforeUnloadWhileBIsActive)).toBe(false);
    expect(beforeUnloadWhileBIsActive.defaultPrevented).toBe(true);

    pending[0].resolve();
    await act(async () => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pending.map((item) => item.payload.annotation_guide)).toEqual(["B", "A"]);

    pending[1].resolve();
    await act(async () => undefined);
    const beforeUnloadAfterAIsSaved = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(beforeUnloadAfterAIsSaved)).toBe(true);
    expect(beforeUnloadAfterAIsSaved.defaultPrevented).toBe(false);
    unmount();
  });

  it("切换项目时 flush 原项目防抖中的最新草稿", async () => {
    const { rerender } = render(
      <AnnotationGuideSection project={makeProject({ id: "p-a", annotation_guide: "# A" })} />,
    );
    const editorA = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();
    fireEvent.change(editorA, { target: { value: "# A 最新" } });

    rerender(
      <AnnotationGuideSection project={makeProject({ id: "p-b", annotation_guide: "# B" })} />,
    );
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# A 最新" });
    expect(mockMutationOwners).toEqual(["p-a"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => undefined);
    const editorB = screen.getByTestId("markdown-editor") as HTMLTextAreaElement;
    fireEvent.change(editorB, { target: { value: "# B 最新" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# B 最新" });
    expect(mockMutationOwners).toEqual(["p-a", "p-b"]);
  });

  it("卸载时 flush 最新草稿，未改变内容不会写入", async () => {
    const first = render(<AnnotationGuideSection project={makeProject()} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: "# 卸载前保存" } });
    first.unmount();
    expect(mockMutateAsync).toHaveBeenCalledWith({ annotation_guide: "# 卸载前保存" });
    vi.useRealTimers();

    const second = render(
      <StrictMode>
        <AnnotationGuideSection project={makeProject({ annotation_guide: "# 不变" })} />
      </StrictMode>,
    );
    await screen.findByTestId("markdown-editor");
    second.unmount();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("退役项目的保存失败不会污染新项目状态或提示", async () => {
    let rejectOld: ((error: Error) => void) | undefined;
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    const { rerender } = render(
      <AnnotationGuideSection project={makeProject({ id: "p-old", annotation_guide: "# 旧" })} />,
    );
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: "# 旧稿" } });
    rerender(
      <AnnotationGuideSection project={makeProject({ id: "p-new", annotation_guide: "# 新" })} />,
    );

    rejectOld?.(new Error("旧项目失败"));
    await act(async () => undefined);
    expect(mockPushToast).not.toHaveBeenCalled();
    expect(screen.getByTestId("guide-save-status")).toHaveTextContent("已保存");
  });
});
