/**
 * v0.9.14 · GeneralSection 单测 — 项目基本信息 controlled form 主路径.
 *
 * 覆盖: 加载初值 / dirty 检测 / 类别添加 删除 / 校验空名 / 保存 mutation 触发.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUpdateMutate = vi.fn();
const mockPushToast = vi.fn();
const mockUseMLBackends = vi.fn();
const mockUseUnsavedWarning = vi.fn();

vi.mock("@/hooks/useProjects", () => ({
  useUpdateProject: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));
vi.mock("@/hooks/useMLBackends", () => ({
  useMLBackends: () => mockUseMLBackends(),
}));
vi.mock("@/hooks/useUnsavedWarning", () => ({
  useUnsavedWarning: (...args: unknown[]) => mockUseUnsavedWarning(...args),
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { GeneralSection } from "./GeneralSection";
import type { ProjectResponse } from "@/api/projects";

function makeProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: "p1",
    display_id: "P-1",
    name: "Demo Project",
    type_key: "image-det",
    type_label: "图像检测",
    status: "in_progress",
    due_date: null,
    classes: ["car", "person"],
    classes_config: null,
    ai_enabled: false,
    ai_model: null,
    ml_backend_id: null,
    iou_dedup_threshold: 0.7,
    box_threshold: 0.35,
    text_threshold: 0.25,
    text_output_default: null,
    attribute_schema: null,
    description: null,
    completed_count: 0,
    total_tasks_count: 0,
    pending_review_count: 0,
    in_review_count: 0,
    rejected_count: 0,
    members_count: 0,
    pre_annotated_batch_count: 0,
    annotating_batch_count: 0,
    review_batch_count: 0,
    completed_batch_count: 0,
    archived_batch_count: 0,
    created_at: "2026-05-09T00:00:00Z",
    updated_at: null,
    ...overrides,
  } as ProjectResponse;
}

function renderUI(project: ProjectResponse) {
  return render(
    <MemoryRouter>
      <GeneralSection project={project} />
    </MemoryRouter>,
  );
}

describe("GeneralSection", () => {
  beforeEach(() => {
    mockUpdateMutate.mockReset();
    mockPushToast.mockReset();
    mockUseMLBackends.mockReturnValue({ data: [] });
    mockUseUnsavedWarning.mockReset();
  });

  it("渲染初值: 项目名 / 状态 / 类别 chips", () => {
    renderUI(makeProject());
    const nameInput = screen.getByDisplayValue("Demo Project") as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(screen.getByText("car")).toBeInTheDocument();
    expect(screen.getByText("person")).toBeInTheDocument();
  });

  it("修改项目名 → useUnsavedWarning 收到 dirty=true", () => {
    renderUI(makeProject());
    const nameInput = screen.getByDisplayValue("Demo Project") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    // useUnsavedWarning 在每次 render 都被调用; 取最后一次
    const calls = mockUseUnsavedWarning.mock.calls;
    expect(calls[calls.length - 1][0]).toBe(true);
  });

  it("空名保存 → 弹 toast 阻止 mutation", () => {
    renderUI(makeProject());
    const nameInput = screen.getByDisplayValue("Demo Project") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(mockPushToast).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining("项目名称不能为空") }),
    );
  });

  it("启用 AI + 默认 preset 模型 → mutation 携带 ai_enabled=true + ai_model", () => {
    renderUI(makeProject());
    // 勾选启用 AI (默认 aiChoice = PRESET_AI_MODELS[0], 即合法模型名)
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockUpdateMutate.mock.calls[0];
    expect(payload.ai_enabled).toBe(true);
    expect(typeof payload.ai_model).toBe("string");
    expect((payload.ai_model as string).length).toBeGreaterThan(0);
  });

  it("类别 chip 删除按钮触发删除", () => {
    renderUI(makeProject());
    const removeBtn = screen.getByLabelText("删除 car");
    fireEvent.click(removeBtn);
    // 删除后 unsaved warning 应感知到 dirty
    const calls = mockUseUnsavedWarning.mock.calls;
    expect(calls[calls.length - 1][0]).toBe(true);
    expect(screen.queryByText("car")).not.toBeInTheDocument();
  });

  it("回车添加类别 → chip 出现", () => {
    renderUI(makeProject());
    const addInput = screen.getByPlaceholderText("回车添加") as HTMLInputElement;
    fireEvent.change(addInput, { target: { value: "truck" } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    expect(screen.getByText("truck")).toBeInTheDocument();
  });

  it("有效改动后保存触发 update.mutate, 名字 trim", () => {
    renderUI(makeProject());
    const nameInput = screen.getByDisplayValue("Demo Project") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "  Renamed  " } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockUpdateMutate.mock.calls[0];
    expect(payload).toMatchObject({ name: "Renamed", status: "in_progress" });
  });
});
