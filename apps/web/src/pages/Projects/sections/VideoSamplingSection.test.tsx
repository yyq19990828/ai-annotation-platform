/**
 * v0.10.29 · VideoSamplingSection 单测 — 项目级视频帧采样配置.
 *
 * 覆盖: 初值加载 / mode 切换 / fps & step 输入 / 预览文案 /
 *       保存 payload 形态 / 非法态禁用保存且不提交.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUpdateMutate = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/hooks/useProjects", () => ({
  useUpdateProject: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { VideoSamplingSection } from "./VideoSamplingSection";
import type { ProjectResponse, VideoSamplingConfig } from "@/api/projects";

function makeProject(
  video_sampling?: VideoSamplingConfig | null,
): ProjectResponse {
  return {
    id: "p1",
    display_id: "P-1",
    name: "Demo Video",
    type_key: "video-det",
    type_label: "视频检测",
    data_type: "video",
    status: "in_progress",
    classes: [],
    video_sampling: video_sampling ?? null,
  } as unknown as ProjectResponse;
}

function getSaveButton() {
  return screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement;
}

describe("VideoSamplingSection", () => {
  beforeEach(() => {
    mockUpdateMutate.mockReset();
    mockPushToast.mockReset();
  });

  it("默认无配置 → mode=none, 预览显示不采样, 保存提交 { mode: none }", () => {
    render(<VideoSamplingSection project={makeProject()} />);
    expect(screen.getByTestId("video-sampling-preview").textContent).toMatch(
      /不采样/,
    );
    fireEvent.click(getSaveButton());
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateMutate.mock.calls[0][0]).toEqual({
      video_sampling: { mode: "none" },
    });
  });

  it("加载已有 fps 配置作为初值", () => {
    render(
      <VideoSamplingSection
        project={makeProject({ mode: "fps", target_fps: 10 })}
      />,
    );
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByTestId("video-sampling-preview").textContent).toMatch(
      /标注 10 fps/,
    );
  });

  it("切到 fps 模式但 target 为空 → 保存按钮禁用, 不提交", () => {
    render(<VideoSamplingSection project={makeProject()} />);
    fireEvent.click(screen.getByLabelText("按目标 fps"));
    const btn = getSaveButton();
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });

  it("fps 模式填合法 target → 提交 { mode: fps, target_fps }", () => {
    render(<VideoSamplingSection project={makeProject()} />);
    fireEvent.click(screen.getByLabelText("按目标 fps"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "12" },
    });
    expect(screen.getByTestId("video-sampling-preview").textContent).toMatch(
      /标注 12 fps/,
    );
    fireEvent.click(getSaveButton());
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateMutate.mock.calls[0][0]).toEqual({
      video_sampling: { mode: "fps", target_fps: 12 },
    });
  });

  it("step 模式填合法整数 → 提交 { mode: step, frame_step }, 预览含 step", () => {
    render(<VideoSamplingSection project={makeProject()} />);
    fireEvent.click(screen.getByLabelText("按帧间隔"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "5" },
    });
    expect(screen.getByTestId("video-sampling-preview").textContent).toMatch(
      /每 5 帧打点/,
    );
    fireEvent.click(getSaveButton());
    expect(mockUpdateMutate.mock.calls[0][0]).toEqual({
      video_sampling: { mode: "step", frame_step: 5 },
    });
  });

  it("step 模式填 0（<1）→ 保存禁用, 不提交", () => {
    render(<VideoSamplingSection project={makeProject()} />);
    fireEvent.click(screen.getByLabelText("按帧间隔"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "0" },
    });
    expect(getSaveButton()).toBeDisabled();
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });
});
