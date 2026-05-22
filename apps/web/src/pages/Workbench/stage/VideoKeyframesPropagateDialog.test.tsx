import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VideoKeyframesPropagateDialog } from "./VideoKeyframesPropagateDialog";

describe("VideoKeyframesPropagateDialog", () => {
  it("closed 时不渲染", () => {
    render(<VideoKeyframesPropagateDialog open={false} frameIndex={5} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId("video-keyframes-propagate-dialog")).toBeNull();
  });

  it("默认 forward + count 10 提交 payload", () => {
    const onSubmit = vi.fn();
    render(<VideoKeyframesPropagateDialog open frameIndex={5} onCancel={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("复制"));
    expect(onSubmit).toHaveBeenCalledWith({ direction: "forward", count: 10, overwrite: false });
  });

  it("选 向前 + 勾选覆盖 + 改帧数 后提交", () => {
    const onSubmit = vi.fn();
    render(<VideoKeyframesPropagateDialog open frameIndex={20} onCancel={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("向前"));
    fireEvent.click(screen.getByText("5"));
    fireEvent.click(screen.getByLabelText("覆盖目标帧已有关键帧"));
    fireEvent.click(screen.getByText("复制"));
    expect(onSubmit).toHaveBeenCalledWith({ direction: "backward", count: 5, overwrite: true });
  });

  it("背景点击触发 onCancel", () => {
    const onCancel = vi.fn();
    render(<VideoKeyframesPropagateDialog open frameIndex={5} onCancel={onCancel} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId("video-keyframes-propagate-dialog"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("step===1 (采样关闭): 标签为「帧数」, range 用 F{from}→F{to}, 行为不变", () => {
    render(
      <VideoKeyframesPropagateDialog open frameIndex={5} samplingStep={1} onCancel={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("帧数")).toBeTruthy();
    // forward + count 10 → F5 → F15
    expect(screen.getByText("F5 → F15")).toBeTruthy();
  });

  it("step>1 (采样开启): 标签为「格数」, count 以网格格子计, 提交换算回源帧", () => {
    const onSubmit = vi.fn();
    render(
      <VideoKeyframesPropagateDialog open frameIndex={50} samplingStep={10} onCancel={vi.fn()} onSubmit={onSubmit} />,
    );
    expect(screen.getByText("格数")).toBeTruthy();
    // count=10 格 · step=10 → 源帧跨度 100, G5 → G15 (F50 → F150)
    expect(screen.getByText("G5 → G15 (F50 → F150)")).toBeTruthy();
    fireEvent.click(screen.getByText("复制"));
    expect(onSubmit).toHaveBeenCalledWith({ direction: "forward", count: 100, overwrite: false });
  });

  it("step>1 + 向前: target 与 payload 同步乘 step", () => {
    const onSubmit = vi.fn();
    render(
      <VideoKeyframesPropagateDialog open frameIndex={100} samplingStep={5} onCancel={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByText("向前"));
    fireEvent.click(screen.getByText("5"));
    // count=5 格 · step=5 → 源帧跨度 25, 向前: F100 → F75, G20 → G15
    expect(screen.getByText("G20 → G15 (F100 → F75)")).toBeTruthy();
    fireEvent.click(screen.getByText("复制"));
    expect(onSubmit).toHaveBeenCalledWith({ direction: "backward", count: 25, overwrite: false });
  });
});
