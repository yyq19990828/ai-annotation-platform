import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VideoTrackerPropagateDialog } from "./VideoTrackerPropagateDialog";

const baseProps = {
  open: true as const,
  maxFrame: 1000,
  nextKeyframeAfter: null,
  submitting: false,
  onCancel: vi.fn(),
};

describe("VideoTrackerPropagateDialog", () => {
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
});
