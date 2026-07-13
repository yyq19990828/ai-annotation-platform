import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  resolveTrackerDefaultModel,
  visibleTrackerModelOptions,
  VideoTrackerPropagateDialog,
} from "./VideoTrackerPropagateDialog";
import { videoDialogMemoryStorageKey } from "../state/videoDialogMemory";

const baseProps = {
  open: true as const,
  maxFrame: 1000,
  nextKeyframeAfter: null,
  submitting: false,
  onCancel: vi.fn(),
};

function firePointerEvent(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: MouseEventInit & { pointerId: number },
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(element, event);
}

describe("visibleTrackerModelOptions", () => {
  const has = (opts: Array<{ value: string }>, v: string) => opts.some((o) => o.value === v);

  it("生产构建始终隐藏 mock_bbox (即便没绑后端)", () => {
    expect(has(visibleTrackerModelOptions(false, false), "mock_bbox")).toBe(false);
    expect(has(visibleTrackerModelOptions(true, false), "mock_bbox")).toBe(false);
  });

  it("dev 构建未绑后端时保留 mock_bbox, 绑后端仍过滤", () => {
    expect(has(visibleTrackerModelOptions(false, true), "mock_bbox")).toBe(true);
    expect(has(visibleTrackerModelOptions(true, true), "mock_bbox")).toBe(false);
  });

  it("过滤后仍保留真实模型", () => {
    const prod = visibleTrackerModelOptions(false, false);
    expect(has(prod, "sam2_video")).toBe(true);
    expect(has(prod, "sam3_video_interactive")).toBe(true);
  });
});

describe("VideoTrackerPropagateDialog", () => {
  it("按 项目默认 > 用户记忆 > 首个真实模型 > mock 解析默认模型", () => {
    expect(resolveTrackerDefaultModel({
      projectDefaultModel: "sam3_video",
      rememberedModel: "sam2_video",
      preferNonMockModel: true,
    })).toBe("sam3_video");
    expect(resolveTrackerDefaultModel({
      projectDefaultModel: "missing",
      rememberedModel: "sam2_video",
      preferNonMockModel: true,
    })).toBe("sam2_video");
    expect(resolveTrackerDefaultModel({
      projectDefaultModel: null,
      rememberedModel: null,
      preferNonMockModel: true,
    })).toBe("sam2_video");
    expect(resolveTrackerDefaultModel({
      projectDefaultModel: null,
      rememberedModel: null,
      preferNonMockModel: false,
    })).toBe("mock_bbox");
  });

  it("已绑真实后端 (preferNonMockModel) 时下拉隐藏 mock_bbox, 默认落真实模型", () => {
    // 即便用户记忆里残留 mock_bbox, 绑后端项目也不应复现它。
    window.localStorage.setItem(
      videoDialogMemoryStorageKey("u1", "trackerPropagate"),
      JSON.stringify({ rangePreset: "30", direction: "forward", modelKey: "mock_bbox", samVariant: "" }),
    );
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        userId="u1"
        preferNonMockModel
        onSubmit={vi.fn()}
      />,
    );
    const modelSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const values = Array.from(modelSelect.options).map((o) => o.value);
    expect(values).not.toContain("mock_bbox");
    expect(modelSelect.value).toBe("sam2_video");
  });

  it("未绑后端 / 测试环境仍保留 mock_bbox 可见", () => {
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={50} onSubmit={vi.fn()} />,
    );
    const modelSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const values = Array.from(modelSelect.options).map((o) => o.value);
    expect(values).toContain("mock_bbox");
  });

  it("上报当前影响范围给时间轴高亮, 随方向/预设变化更新, 关闭清空", () => {
    const onRangeChange = vi.fn();
    const { rerender } = render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        samplingStep={1}
        onRangeChange={onRangeChange}
        onSubmit={vi.fn()}
      />,
    );
    // 默认 forward + 30 帧 → F50 → F80。
    expect(onRangeChange).toHaveBeenLastCalledWith({ startFrame: 50, endFrame: 80 });
    // 切「向前」→ F20 → F50。
    fireEvent.click(screen.getByTestId("tracker-direction-backward"));
    expect(onRangeChange).toHaveBeenLastCalledWith({ startFrame: 20, endFrame: 50 });
    // 关闭 → 清空。
    rerender(
      <VideoTrackerPropagateDialog
        {...baseProps}
        open={false}
        frameIndex={50}
        onRangeChange={onRangeChange}
        onSubmit={vi.fn()}
      />,
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(null);
  });

  it("时间轴刷选回填自定义范围, 覆盖预设; 改预设即回派生范围", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onRangeChange = vi.fn();
    const { rerender } = render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        samplingStep={1}
        brushedRange={null}
        onRangeChange={onRangeChange}
        onSubmit={onSubmit}
      />,
    );
    // 默认 forward + 30 帧 → F50 → F80。
    expect(screen.getByText("F50 → F80")).toBeTruthy();
    expect(screen.queryByTestId("tracker-range-custom")).toBeNull();

    // 刷选 F10→F42 回填 → 覆盖为自定义范围, 上报高亮 + 提交都用它。
    rerender(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        samplingStep={1}
        brushedRange={{ startFrame: 10, endFrame: 42 }}
        onRangeChange={onRangeChange}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText("F10 → F42")).toBeTruthy();
    expect(screen.getByTestId("tracker-range-custom")).toBeInTheDocument();
    expect(onRangeChange).toHaveBeenLastCalledWith({ startFrame: 10, endFrame: 42 });
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ from_frame: 10, to_frame: 42 }),
    );

    // 改预设 → 清自定义, 回派生范围。
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "60" } });
    expect(screen.getByText("F50 → F110")).toBeTruthy();
    expect(screen.queryByTestId("tracker-range-custom")).toBeNull();
  });

  it("closed 时不渲染", () => {
    render(
      <VideoTrackerPropagateDialog {...baseProps} open={false} frameIndex={5} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByTestId("video-tracker-propagate-dialog")).toBeNull();
  });

  it("以紧凑检查器停靠画布右侧，并与 AI 单题共用面板内部视觉骨架", () => {
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={5} onSubmit={vi.fn()} />,
    );

    const panel = screen.getByTestId("video-tracker-propagate-dialog");
    expect(panel.className).toContain("right-2");
    expect(panel.className).toContain(
      "w-[var(--tracker-panel-w,min(360px,calc(100%-1rem)))]",
    );
    expect(panel.className).toContain("border-violet-500/35");
    expect(panel.className).toContain("rounded-lg");
    expect(panel.className).not.toContain("left-1/2");

    const header = screen.getByTestId("tracker-panel-header");
    expect(header.className).toContain("from-violet-500/10");
    expect(header.className).toContain("px-3.5");
    expect(header.className).toContain("py-3");

    const settings = screen.getByTestId("tracker-settings-section");
    expect(settings.className).toContain("bg-muted");
    expect(settings.className).toContain("px-3.5");
    expect(settings.className).toContain("py-2.5");

    expect(screen.getByRole("button", { name: "开始追踪" }).className).toContain(
      "border-violet-500/30",
    );
  });

  it("拖动头部时在画布范围内更新位置", () => {
    const onPositionChange = vi.fn();
    render(
      <div data-testid="stage-parent">
        <VideoTrackerPropagateDialog
          {...baseProps}
          frameIndex={5}
          onPositionChange={onPositionChange}
          onSubmit={vi.fn()}
        />
      </div>,
    );

    const panel = screen.getByTestId("video-tracker-propagate-dialog");
    const parent = screen.getByTestId("stage-parent");
    Object.defineProperty(panel, "offsetParent", { configurable: true, value: parent });
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 50, width: 900, height: 700, right: 1000, bottom: 750,
      x: 100, y: 50, toJSON: () => ({}),
    });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      left: 500, top: 100, width: 360, height: 500, right: 860, bottom: 600,
      x: 500, y: 100, toJSON: () => ({}),
    });

    const header = screen.getByTestId("tracker-panel-header");
    firePointerEvent(header, "pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 520,
      clientY: 120,
    });
    firePointerEvent(header, "pointermove", { pointerId: 1, clientX: 320, clientY: 270 });
    firePointerEvent(header, "pointerup", { pointerId: 1 });

    expect(onPositionChange).toHaveBeenNthCalledWith(1, { left: 400, top: 50 });
    expect(onPositionChange).toHaveBeenLastCalledWith({ left: 200, top: 192 });
  });

  it("拖动右下角时更新尺寸，并把默认停靠转换为显式位置", () => {
    const onPositionChange = vi.fn();
    const onSizeChange = vi.fn();
    render(
      <div data-testid="stage-parent">
        <VideoTrackerPropagateDialog
          {...baseProps}
          frameIndex={5}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onSubmit={vi.fn()}
        />
      </div>,
    );

    const panel = screen.getByTestId("video-tracker-propagate-dialog");
    const parent = screen.getByTestId("stage-parent");
    Object.defineProperty(panel, "offsetParent", { configurable: true, value: parent });
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 50, width: 900, height: 700, right: 1000, bottom: 750,
      x: 100, y: 50, toJSON: () => ({}),
    });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      left: 500, top: 100, width: 360, height: 500, right: 860, bottom: 600,
      x: 500, y: 100, toJSON: () => ({}),
    });

    const handle = screen.getByTestId("tracker-panel-resize-handle");
    firePointerEvent(handle, "pointerdown", {
      button: 0,
      pointerId: 2,
      clientX: 860,
      clientY: 600,
    });
    firePointerEvent(handle, "pointermove", { pointerId: 2, clientX: 920, clientY: 650 });
    firePointerEvent(handle, "pointerup", { pointerId: 2 });

    expect(onPositionChange).toHaveBeenLastCalledWith({ left: 400, top: 50 });
    expect(onSizeChange).toHaveBeenLastCalledWith({ w: 420, h: 550 });
  });

  it("step===1 (采样关闭): 预设标签为「N 帧」, range 用 F{from}→F{to}, 提交源帧", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={50} samplingStep={1} onSubmit={onSubmit} />,
    );
    // 默认 forward + 30 帧 → F50 → F80
    expect(screen.getByText("30 帧")).toBeTruthy();
    expect(screen.getByText("F50 → F80")).toBeTruthy();
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ from_frame: 50, to_frame: 80, direction: "forward" }),
    );
  });

  it("submits the explicitly selected mask geometry", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={20}
        preferNonMockModel
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByTestId("tracker-output-geometry"), { target: { value: "mask" } });
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ output_geometry: "mask" }));
  });

  it("step>1 (采样开启): 预设语义为网格格子, span 乘 step, range 显示网格序号", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={100} samplingStep={10} onSubmit={onSubmit} />,
    );
    // 默认 30 格 · step=10 → ≈300 帧, forward: F100 → F400, G10 → G40
    expect(screen.getByText("30 格 (≈300 帧)")).toBeTruthy();
    expect(screen.getByText("G10 → G40 (F100 → F400)")).toBeTruthy();
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ from_frame: 100, to_frame: 400, direction: "forward" }),
    );
  });

  it("step>1 + backward: span 向前乘 step", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={500} samplingStep={10} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByTestId("tracker-direction-backward"));
    // 30 格 · step=10 → 300 帧, backward: F200 → F500
    expect(screen.getByText("G20 → G50 (F200 → F500)")).toBeTruthy();
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ from_frame: 200, to_frame: 500, direction: "backward" }),
    );
  });

  it("到结尾 / 到下一关键帧 预设不受 step 影响 (标签固定)", () => {
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={100} samplingStep={10} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("到结尾")).toBeTruthy();
    expect(screen.getByText("到下一关键帧")).toBeTruthy();
  });

  it("提交成功后记住范围 / 方向 / 模型 / 变体,重开作为初值", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={80}
        userId="u1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "60" } });
    fireEvent.click(screen.getByTestId("tracker-direction-backward"));
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "sam2_video" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[2], {
      target: { value: "large" },
    });
    fireEvent.click(screen.getByText("开始追踪"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        from_frame: 20,
        to_frame: 80,
        direction: "backward",
        model_key: "sam2_video",
        sam_variant: "large",
      }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(videoDialogMemoryStorageKey("u1", "trackerPropagate")))
        .toContain("sam2_video"),
    );

    rerender(
      <VideoTrackerPropagateDialog
        {...baseProps}
        open={false}
        frameIndex={80}
        userId="u1"
        onSubmit={onSubmit}
      />,
    );
    rerender(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={80}
        userId="u1"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("F20 → F80")).toBeTruthy();
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("sam2_video");
    expect((screen.getAllByRole("combobox")[2] as HTMLSelectElement).value).toBe("large");
  });

  it("SAM 尺寸档位只对 sam2_video 显示, sam3 系隐藏且提交不带 sam_variant", () => {
    const onSubmit = vi.fn();
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        projectDefaultModel="sam2_video"
        preferNonMockModel
        onSubmit={onSubmit}
      />,
    );
    const modelSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect(modelSelect.value).toBe("sam2_video");
    // sam2_video → 尺寸(SAM2 档位)选择器可见。
    expect(screen.queryByText("尺寸")).toBeTruthy();
    // 切到 sam3 点框交互 → 尺寸选择器消失(sam3 用各自权重, 无 SAM2 档位)。
    fireEvent.change(modelSelect, { target: { value: "sam3_video_interactive" } });
    expect(screen.queryByText("尺寸")).toBeNull();
    // 提交(sam3)→ payload 不带 sam_variant。
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model_key: "sam3_video_interactive" }),
    );
    expect(onSubmit.mock.calls[0][0].sam_variant).toBeUndefined();
  });

  it("项目默认模型优先于用户记忆作为打开时初值", async () => {
    window.localStorage.setItem(
      videoDialogMemoryStorageKey("u1", "trackerPropagate"),
      JSON.stringify({
        rangePreset: "30",
        direction: "forward",
        modelKey: "mock_bbox",
        samVariant: "",
      }),
    );
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={80}
        userId="u1"
        projectDefaultModel="sam3_video"
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("sam3_video");
  });


  it("sam3_video 未在 supported_trackers 声明时灰置 (option disabled), 提交按钮禁用", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        projectDefaultModel="sam3_video"
        onSubmit={vi.fn()}
      />,
    );
    const modelSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const sam3Option = Array.from(modelSelect.options).find((o) => o.value === "sam3_video");
    expect(sam3Option?.disabled).toBe(true);
    // 选中的是被灰置的 sam3_video → 提交按钮禁用。
    expect((screen.getByText("开始追踪").closest("button") as HTMLButtonElement).disabled).toBe(true);
    // 未灰置的 sam2_video 不受门控。
    const sam2Option = Array.from(modelSelect.options).find((o) => o.value === "sam2_video");
    expect(sam2Option?.disabled).toBe(false);
  });

  it("backend 声明 sam3_video 后可选, 显 text 框, 提交带 text", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        projectDefaultModel="sam3_video"
        supportedTrackers={["sam2_video", "sam3_video"]}
        textDrivenTrackers={["sam3_video"]}
        onSubmit={onSubmit}
      />,
    );
    // sam3_video 已声明 → 不灰置, 默认选中它 → text 框出现。
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("sam3_video");
    const textInput = screen.getByTestId("tracker-text-input") as HTMLInputElement;
    expect(textInput).toBeTruthy();
    // 空 text 提交被拦。
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("文本驱动追踪需填写文本描述")).toBeTruthy();
    // 填 text → 提交带 text。
    fireEvent.change(textInput, { target: { value: "the red car" } });
    fireEvent.click(screen.getByText("开始追踪"));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ model_key: "sam3_video", text: "the red car" }),
      ),
    );
  });

  it("seed-bbox tracker (sam2_video) 不显 text 框, 提交不带 text", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        projectDefaultModel="sam2_video"
        supportedTrackers={["sam2_video"]}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByTestId("tracker-text-input")).toBeNull();
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model_key: "sam2_video", text: undefined }),
    );
  });

  it("种子入口: sam3_video_interactive 与 sam2_video 都显示, mock/文本驱动不显示", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        onSubmit={vi.fn()}
        onToggleSeedCollecting={vi.fn()}
      />,
    );
    // 默认 mock_bbox → 无种子入口。
    expect(screen.queryByTestId("tracker-seed-toggle")).toBeNull();
    // 切 sam3_video_interactive → 出现。
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "sam3_video_interactive" },
    });
    expect(screen.getByTestId("tracker-seed-toggle")).toBeTruthy();
    // 切 sam2_video → 仍显示 (v0.21.27 阶段 A: grounded-sam2 也吃 seeds[] 多目标/点/框)。
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "sam2_video" },
    });
    expect(screen.getByTestId("tracker-seed-toggle")).toBeTruthy();
  });

  it("点「落点选目标」调 onToggleSeedCollecting; 采集态改文案; 有落点显计数 + 清空", () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    const seedProps = {
      ...baseProps,
      frameIndex: 50,
      projectDefaultModel: "sam3_video_interactive",
      onSubmit: vi.fn(),
      onToggleSeedCollecting: onToggle,
      onClearSeeds: onClear,
    };
    const { rerender } = render(<VideoTrackerPropagateDialog {...seedProps} />);
    const toggle = screen.getByTestId("tracker-seed-toggle");
    expect(toggle.textContent).toContain("落点选目标");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalled();
    // 采集态 + 已落 2 点。
    rerender(
      <VideoTrackerPropagateDialog {...seedProps} seedCollecting seedPointCount={2} />,
    );
    expect(screen.getByTestId("tracker-seed-toggle").textContent).toContain("落点中");
    expect(screen.getByTestId("tracker-seed-count").textContent).toContain("已落 2 点");
    fireEvent.click(screen.getByText("清空"));
    expect(onClear).toHaveBeenCalled();
  });

  it("多目标: 「+新目标」调 onNewSeedTarget; 计数在 >1 目标时才显示目标数", () => {
    const onNewTarget = vi.fn();
    const seedProps = {
      ...baseProps,
      frameIndex: 50,
      projectDefaultModel: "sam3_video_interactive",
      onSubmit: vi.fn(),
      onToggleSeedCollecting: vi.fn(),
      onNewSeedTarget: onNewTarget,
      seedPointCount: 1,
      seedTargetCount: 1,
    };
    const { rerender } = render(<VideoTrackerPropagateDialog {...seedProps} />);
    // 单目标: 只显示点数, 不缀「目标」。
    const count = () => screen.getByTestId("tracker-seed-count").textContent ?? "";
    expect(count()).toContain("已落 1 点");
    expect(count()).not.toContain("目标");
    fireEvent.click(screen.getByTestId("tracker-seed-new-target"));
    expect(onNewTarget).toHaveBeenCalled();
    // 多目标 (>1): 缀「M 目标」。
    rerender(
      <VideoTrackerPropagateDialog {...seedProps} seedPointCount={3} seedTargetCount={2} />,
    );
    expect(count()).toContain("2 目标");
    // 纠偏多帧 (>1): 缀「K 帧」; 单目标时不缀「目标」。
    rerender(
      <VideoTrackerPropagateDialog
        {...seedProps}
        seedPointCount={2}
        seedTargetCount={1}
        seedFrameCount={2}
      />,
    );
    expect(count()).toContain("2 帧");
    expect(count()).not.toContain("目标");
  });

  it("取消不写记忆,且非法模型 / 变体安全回退", () => {
    const key = videoDialogMemoryStorageKey("u1", "trackerPropagate");
    const remembered = {
      rangePreset: "60",
      direction: "bidirectional",
      modelKey: "missing-model",
      samVariant: "huge",
    };
    window.localStorage.setItem(key, JSON.stringify(remembered));
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={80}
        userId="u1"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("F20 → F140")).toBeTruthy();
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("mock_bbox");
    fireEvent.click(screen.getByTestId("tracker-direction-backward"));
    fireEvent.click(screen.getByTestId("video-tracker-propagate-dialog"));

    expect(window.localStorage.getItem(key)).toBe(JSON.stringify(remembered));
  });

  it("B-combo · 发现追踪需双 sam3 能力, 提交带 model_key + text + 目标类别", () => {
    const onSubmit = vi.fn();
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={0}
        supportedTrackers={["sam3_video", "sam3_video_interactive"]}
        textDrivenTrackers={["sam3_video"]}
        availableClasses={["car", "person"]}
        onSubmit={onSubmit}
        onToggleSeedCollecting={vi.fn()}
      />,
    );
    const modelSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const comboOption = Array.from(modelSelect.options).find(
      (o) => o.value === "sam3_video_combo",
    ) as HTMLOptionElement;
    // 双能力就绪 → combo 可选。
    expect(comboOption.disabled).toBe(false);
    fireEvent.change(modelSelect, { target: { value: "sam3_video_combo" } });
    // 文本框 (文本驱动) 出现并填写。
    fireEvent.change(screen.getByTestId("tracker-text-input"), { target: { value: "car" } });
    // 目标类别选择器 (发现即新建) 默认首个 car。
    expect((screen.getByTestId("tracker-target-class") as HTMLSelectElement).value).toBe("car");
    fireEvent.click(screen.getByText("开始追踪"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        model_key: "sam3_video_combo",
        text: "car",
        target_class_name: "car",
        target_tool_unit_id: "bbox",
      }),
    );
  });

  it("B-combo · 缺 sam3 能力 (只 sam3_video) 时发现追踪灰置", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={0}
        supportedTrackers={["sam3_video"]}
        textDrivenTrackers={["sam3_video"]}
        onSubmit={vi.fn()}
      />,
    );
    const modelSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const comboOption = Array.from(modelSelect.options).find(
      (o) => o.value === "sam3_video_combo",
    ) as HTMLOptionElement;
    expect(comboOption.disabled).toBe(true);
  });

  it("U1: 方向按钮用消歧标签 (更晚/更早帧) + testid", () => {
    render(<VideoTrackerPropagateDialog {...baseProps} frameIndex={50} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("tracker-direction-forward").textContent).toContain("更晚帧");
    expect(screen.getByTestId("tracker-direction-backward").textContent).toContain("更早帧");
    expect(screen.getByTestId("tracker-direction-bidirectional").textContent).toContain("双向");
  });

  it("U6: 大范围显示 ≈N 窗 (sam3 系 16 帧/窗), 小范围不显", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={0}
        projectDefaultModel="sam3_video_interactive"
        onSubmit={vi.fn()}
        onToggleSeedCollecting={vi.fn()}
      />,
    );
    // 默认 forward + 30 帧 → F0→F30 = 31 帧 → ceil(31/16) = 2 窗。
    expect(screen.getByTestId("tracker-window-estimate").textContent).toContain("≈2 窗");
    // 切到 10 帧 → F0→F10 = 11 帧 → ceil(11/16) = 1 窗 → 不显。
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "10" } });
    expect(screen.queryByTestId("tracker-window-estimate")).toBeNull();
  });

  it("框修正: 点/框模式切换调 onChangeSeedMode; 框计数并入「已落」文案", () => {
    const onChangeMode = vi.fn();
    const seedProps = {
      ...baseProps,
      frameIndex: 50,
      projectDefaultModel: "sam3_video_interactive",
      onSubmit: vi.fn(),
      onToggleSeedCollecting: vi.fn(),
      onChangeSeedMode: onChangeMode,
    };
    const { rerender } = render(<VideoTrackerPropagateDialog {...seedProps} seedMode="point" />);
    // 点「框」→ onChangeSeedMode("box")。
    fireEvent.click(screen.getByTestId("tracker-seed-mode-box"));
    expect(onChangeMode).toHaveBeenCalledWith("box");
    // box 模式 → toggle 文案变「画框选目标」。
    rerender(<VideoTrackerPropagateDialog {...seedProps} seedMode="box" />);
    expect(screen.getByTestId("tracker-seed-toggle").textContent).toContain("画框选目标");
    // 点 1 + 框 2 → 计数含「1 点」与「2 框」。
    rerender(
      <VideoTrackerPropagateDialog
        {...seedProps}
        seedMode="box"
        seedPointCount={1}
        seedBoxCount={2}
      />,
    );
    const count = screen.getByTestId("tracker-seed-count").textContent ?? "";
    expect(count).toContain("1 点");
    expect(count).toContain("2 框");
  });

  it("A2/A3 · 本次影响摘要: 单纯延展显示源类别", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        sourceTrackClassName="car"
        onSubmit={vi.fn()}
      />,
    );
    const summary = screen.getByTestId("tracker-impact-summary").textContent ?? "";
    expect(summary).toContain("延展选中轨迹");
    expect(summary).toContain("car");
  });

  it("A2 · 多目标种子: 摘要显示延展 + 新建 N 条", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        projectDefaultModel="sam3_video_interactive"
        sourceTrackClassName="car"
        seedTargetCount={3}
        onSubmit={vi.fn()}
        onToggleSeedCollecting={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tracker-impact-summary").textContent).toContain("新建 2 条");
  });

  it("M2 · 多选批量: 摘要显示延展 N 条轨迹 (单类展示类名)", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        sourceCount={3}
        sourceClassNames={["car"]}
        onSubmit={vi.fn()}
      />,
    );
    const summary = screen.getByTestId("tracker-impact-summary").textContent ?? "";
    expect(summary).toContain("延展 3 条轨迹");
    expect(summary).toContain("car");
  });

  it("M2 · 多选批量混类: 摘要显示「N 类」", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        sourceCount={2}
        sourceClassNames={["car", "person"]}
        onSubmit={vi.fn()}
      />,
    );
    const summary = screen.getByTestId("tracker-impact-summary").textContent ?? "";
    expect(summary).toContain("延展 2 条轨迹");
    expect(summary).toContain("2 类");
  });

  it("A3 · 文本检测: 摘要提示新目标继承源类别 (类别继承警示)", () => {
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        projectDefaultModel="sam3_video"
        supportedTrackers={["sam3_video"]}
        textDrivenTrackers={["sam3_video"]}
        sourceTrackClassName="car"
        onSubmit={vi.fn()}
      />,
    );
    const summary = screen.getByTestId("tracker-impact-summary").textContent ?? "";
    expect(summary).toContain("按文本");
    expect(summary).toContain("继承");
    expect(summary).toContain("car");
  });

  it("U8: tracking 态就地转「追踪中…」进度视图, 隐表单 (无范围下拉 / 开始追踪按钮)", () => {
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={50} tracking onSubmit={vi.fn()} />,
    );
    // 进度视图: 追踪中… + tracker-progress; 表单控件不再渲染。
    expect(screen.getByTestId("tracker-progress").textContent).toContain("追踪中");
    expect(screen.queryByText("开始追踪")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    // 对话框本体仍在 (仅内容切换)。
    expect(screen.getByTestId("video-tracker-propagate-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("tracker-panel-header").className).toContain(
      "from-violet-500/10",
    );
  });

  it("U8: 有分窗进度时显示「第 c/t 窗」; 单窗 (total<=1) 不显", () => {
    const { rerender } = render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        tracking
        trackingWindow={{ current: 2, total: 5 }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tracker-progress-window").textContent).toContain("第 2/5 窗");
    rerender(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        tracking
        trackingWindow={{ current: 1, total: 1 }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("tracker-progress-window")).toBeNull();
  });

  it("U8: 进度态点「后台继续」调 onCancel (关闭对话框, 后台继续追踪)", () => {
    const onCancel = vi.fn();
    render(
      <VideoTrackerPropagateDialog
        {...baseProps}
        frameIndex={50}
        tracking
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("后台继续"));
    expect(onCancel).toHaveBeenCalled();
  });
});
