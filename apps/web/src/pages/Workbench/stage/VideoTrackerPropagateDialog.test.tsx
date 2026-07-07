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
    fireEvent.click(screen.getByText("向前"));
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
    fireEvent.click(screen.getByText("向前"));
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
    fireEvent.click(screen.getByText("向前"));
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
    fireEvent.click(screen.getByText("向前"));
    fireEvent.click(screen.getByTestId("video-tracker-propagate-dialog"));

    expect(window.localStorage.getItem(key)).toBe(JSON.stringify(remembered));
  });
});
