import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VideoTrackerReviewBar } from "./VideoTrackerReviewBar";

describe("VideoTrackerReviewBar", () => {
  it("open=false 不渲染", () => {
    render(
      <VideoTrackerReviewBar
        open={false}
        frameCount={0}
        targetCount={0}
        onAccept={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("video-tracker-review-bar")).toBeNull();
  });

  it("显示帧/目标数; 接受与丢弃各调对应 handler", () => {
    const onAccept = vi.fn();
    const onDiscard = vi.fn();
    render(
      <VideoTrackerReviewBar
        open
        frameCount={16}
        targetCount={2}
        onAccept={onAccept}
        onDiscard={onDiscard}
      />,
    );
    const bar = screen.getByTestId("video-tracker-review-bar");
    expect(bar.textContent).toContain("16 帧");
    expect(bar.textContent).toContain("2 目标");
    fireEvent.click(screen.getByTestId("tracker-review-accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("tracker-review-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("单目标不缀「目标」; submitting 时按钮禁用", () => {
    render(
      <VideoTrackerReviewBar
        open
        frameCount={5}
        targetCount={1}
        submitting
        onAccept={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("video-tracker-review-bar");
    expect(bar.textContent).toContain("5 帧");
    expect(bar.textContent).not.toContain("目标");
    expect((screen.getByTestId("tracker-review-accept") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("tracker-review-discard") as HTMLButtonElement).disabled).toBe(true);
  });
});
