import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { VideoIssueLayer } from "./VideoIssueLayer";

function makeIssue(over: Partial<AnnotationFeedback> & { id: string }): AnnotationFeedback {
  return {
    kind: "issue",
    anchor_type: "pixel",
    project_id: "p",
    task_id: "t",
    annotation_id: null,
    anchor_position: { x: 0.5, y: 0.5, frame: 0 },
    status: "open",
    severity: null,
    title: null,
    body: "",
    author_id: "u",
    author_name: null,
    attachments: [],
    thread_parent_id: null,
    is_active: true,
    resolved_at: null,
    resolved_by_id: null,
    created_at: "2026-05-25T00:00:00Z",
    updated_at: null,
    ...over,
  };
}

describe("VideoIssueLayer", () => {
  it("只渲染当前帧命中的图钉", () => {
    render(
      <VideoIssueLayer
        pixelIssues={[
          makeIssue({ id: "a", anchor_position: { x: 0.1, y: 0.1, frame: 3 } }),
          makeIssue({ id: "b", anchor_position: { x: 0.2, y: 0.2, frame: 7 } }),
        ]}
        frameIndex={3}
        viewBoxHeight={0.5625}
      />,
    );
    expect(screen.getByTestId("video-issue-pin-a")).toBeInTheDocument();
    expect(screen.queryByTestId("video-issue-pin-b")).not.toBeInTheDocument();
  });

  it("当前帧无命中图钉时整层不渲染", () => {
    render(
      <VideoIssueLayer
        pixelIssues={[makeIssue({ id: "a", anchor_position: { x: 0.1, y: 0.1, frame: 3 } })]}
        frameIndex={9}
        viewBoxHeight={0.5625}
      />,
    );
    expect(screen.queryByTestId("video-issue-layer")).not.toBeInTheDocument();
  });

  it("单击图钉回调对应 id", () => {
    const onPinClick = vi.fn();
    render(
      <VideoIssueLayer
        pixelIssues={[makeIssue({ id: "a", anchor_position: { x: 0.1, y: 0.1, frame: 0 } })]}
        frameIndex={0}
        viewBoxHeight={0.5625}
        onPinClick={onPinClick}
      />,
    );
    fireEvent.click(screen.getByTestId("video-issue-pin-a").querySelector("circle")!);
    expect(onPinClick).toHaveBeenCalledWith("a");
  });
});
