import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VideoTrackerJobPreview } from "@/api/videoTracker";
import { VideoTrackerReviewBar } from "./VideoTrackerReviewBar";

const preview: VideoTrackerJobPreview = {
  job_id: "job-1",
  status: "partially_reviewed",
  annotation_id: "annotation-1",
  job_revision: 2,
  expected_source_versions: { "annotation-1": 3 },
  candidate_total: 5,
  candidate_pending: 3,
  candidate_accepted: 1,
  candidate_rejected: 1,
  results: [
    {
      frame_index: 10,
      instance_id: "A",
      geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    },
    {
      frame_index: 12,
      instance_id: "A",
      manual_protected: true,
      geometry: { type: "bbox", x: 0.2, y: 0.1, w: 0.2, h: 0.2 },
    },
    {
      frame_index: 11,
      instance_id: "B",
      geometry: { type: "bbox", x: 0.3, y: 0.1, w: 0.2, h: 0.2 },
    },
  ],
  grid_step: 1,
  output_geometry: "bbox",
};

describe("VideoTrackerReviewBar", () => {
  it("open=false 不渲染", () => {
    render(
      <VideoTrackerReviewBar
        open={false}
        preview={null}
        onDecide={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("video-tracker-review-bar")).toBeNull();
  });

  it("按目标和帧窗提交局部 selector", async () => {
    const onDecide = vi.fn().mockResolvedValue({ ok: true });
    render(
      <VideoTrackerReviewBar
        open
        preview={preview}
        onDecide={onDecide}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/已审 2\/5/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tracker-review-instance-B"));
    fireEvent.change(screen.getByTestId("tracker-review-from-frame"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("tracker-review-to-frame"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByTestId("tracker-review-accept"));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({
      instance_ids: ["A"],
      from_frame: 10,
      to_frame: 10,
      decision: "accept",
      override_manual: false,
    }));
  });

  it("manual 409 后确认才以 override 重试", async () => {
    const onDecide = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: "manual_keyframe_protected" })
      .mockResolvedValueOnce({ ok: true });
    const confirmManualOverride = vi.fn(() => true);
    render(
      <VideoTrackerReviewBar
        open
        preview={preview}
        onDecide={onDecide}
        onRefresh={vi.fn()}
        confirmManualOverride={confirmManualOverride}
      />,
    );
    expect(screen.getByTestId("tracker-review-manual-warning")).toHaveTextContent("1 个");
    fireEvent.click(screen.getByTestId("tracker-review-accept"));
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(2));
    expect(confirmManualOverride).toHaveBeenCalledTimes(1);
    expect(onDecide.mock.calls[1][0]).toMatchObject({
      decision: "accept",
      override_manual: true,
    });
  });

  it("无可选 candidate 或提交中时禁用决策", () => {
    render(
      <VideoTrackerReviewBar
        open
        preview={{ ...preview, results: [] }}
        submitting
        onDecide={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tracker-review-accept")).toBeDisabled();
    expect(screen.getByTestId("tracker-review-discard")).toBeDisabled();
  });
});
