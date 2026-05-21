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
});
