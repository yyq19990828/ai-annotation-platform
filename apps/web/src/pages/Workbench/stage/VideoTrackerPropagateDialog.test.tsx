import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  resolveTrackerDefaultModel,
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
    fireEvent.click(screen.getByText("发起传播"));
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

  it("step===1 (采样关闭): 预设标签为「N 帧」, range 用 F{from}→F{to}, 提交源帧", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoTrackerPropagateDialog {...baseProps} frameIndex={50} samplingStep={1} onSubmit={onSubmit} />,
    );
    // 默认 forward + 30 帧 → F50 → F80
    expect(screen.getByText("30 帧")).toBeTruthy();
    expect(screen.getByText("F50 → F80")).toBeTruthy();
    fireEvent.click(screen.getByText("发起传播"));
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
    fireEvent.click(screen.getByText("发起传播"));
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
    fireEvent.click(screen.getByText("发起传播"));
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
    fireEvent.click(screen.getByText("发起传播"));
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
    fireEvent.click(screen.getByText("发起传播"));

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
    expect((screen.getByText("发起传播").closest("button") as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.click(screen.getByText("发起传播"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("文本驱动追踪需填写文本描述")).toBeTruthy();
    // 填 text → 提交带 text。
    fireEvent.change(textInput, { target: { value: "the red car" } });
    fireEvent.click(screen.getByText("发起传播"));
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
    fireEvent.click(screen.getByText("发起传播"));
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
});
