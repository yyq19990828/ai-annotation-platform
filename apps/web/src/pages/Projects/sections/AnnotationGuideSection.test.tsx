/**
 * v0.10.13 · E1 · AnnotationGuideSection 单测 — 编辑 / 预览 / 保存 mutation 主路径.
 *
 * 覆盖:
 * - 渲染 tabs (编辑 / 预览) 默认进入编辑 + 加载初值
 * - 切到预览 tab 渲染 GuideMarkdownView
 * - 修改 markdown → "保存" 触发 useUpdateProject.mutate({ annotation_guide })
 * - 已上传 guide_assets 列表渲染 + 删除按钮调 useGuideAssets.deleteAsset
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockMutate = vi.fn();
const mockPushToast = vi.fn();
const mockUploadAsset = vi.fn();
const mockDeleteAsset = vi.fn();
const mockSignAsset = vi.fn().mockResolvedValue("http://signed/x");

vi.mock("@/hooks/useProjects", () => ({
  useUpdateProject: () => ({ mutate: mockMutate, isPending: false }),
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
    mockMutate.mockReset();
    mockPushToast.mockReset();
    mockUploadAsset.mockReset();
    mockDeleteAsset.mockReset().mockResolvedValue(undefined);
    mockSignAsset.mockClear();
  });

  it("加载初值并默认进入编辑 tab", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "# 初始指引" })} />);
    const editor = await screen.findByTestId("markdown-editor");
    expect((editor as HTMLTextAreaElement).value).toBe("# 初始指引");
    expect(screen.getByTestId("guide-tab-edit")).toHaveAttribute("aria-selected", "true");
  });

  it("修改 markdown 后失焦 → mutation 携带 annotation_guide", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "" })} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# 新指引\n第一条" } });
    fireEvent.blur(editor);
    expect(mockMutate).toHaveBeenCalledWith(
      { annotation_guide: "# 新指引\n第一条" },
      expect.any(Object),
    );
  });

  it("内容未变化失焦 → 不触发 mutation", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "# 初始" })} />);
    const editor = (await screen.findByTestId("markdown-editor")) as HTMLTextAreaElement;
    fireEvent.blur(editor);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("切到预览 tab 渲染 markdown 内容", async () => {
    render(<AnnotationGuideSection project={makeProject({ annotation_guide: "# 预览标题" })} />);
    fireEvent.click(screen.getByTestId("guide-tab-preview"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "预览标题" })).toBeInTheDocument();
    });
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
});
