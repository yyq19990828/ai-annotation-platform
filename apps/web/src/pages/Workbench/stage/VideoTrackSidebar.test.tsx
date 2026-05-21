import { describe, expect, it } from "vitest";
import type { VideoTrackGeometry, VideoTrackOutsideRange } from "@/types";
import { trackRangesOverlap } from "./VideoTrackSidebar";
import type { VideoTrackAnnotation } from "./videoStageTypes";

const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

function track(
  id: string,
  className: string,
  frames: number[],
  outside?: VideoTrackOutsideRange[],
): VideoTrackAnnotation {
  const geometry: VideoTrackGeometry = {
    type: "video_track",
    track_id: `trk_${id}`,
    keyframes: frames.map((frame_index) => ({ frame_index, bbox: box, source: "manual" })),
    ...(outside ? { outside } : {}),
  };
  return {
    id,
    task_id: "task-1",
    project_id: "project-1",
    user_id: "user-1",
    source: "manual",
    annotation_type: "video_track",
    class_name: className,
    geometry,
    confidence: 1,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    attributes: {},
    created_at: "2026-05-21T00:00:00Z",
    updated_at: null,
  };
}

describe("trackRangesOverlap (join eligibility)", () => {
  it("returns false for disjoint visible frame ranges", () => {
    const a = track("a", "Car", [0, 5]);
    const b = track("b", "Car", [10, 20]);
    expect(trackRangesOverlap(a, b)).toBe(false);
  });

  it("returns true for overlapping visible frame ranges", () => {
    const a = track("a", "Car", [0, 12]);
    const b = track("b", "Car", [10, 20]);
    expect(trackRangesOverlap(a, b)).toBe(true);
  });

  it("treats touching endpoints as overlapping", () => {
    const a = track("a", "Car", [0, 10]);
    const b = track("b", "Car", [10, 20]);
    expect(trackRangesOverlap(a, b)).toBe(true);
  });

  it("excludes outside frames so masked tails do not overlap", () => {
    // a 关键帧到 F15, 但 F11-F15 被标记 outside, 可见区间仅到 F10。
    const a = track("a", "Car", [0, 10, 15], [{ from: 11, to: 15, source: "manual" }]);
    const b = track("b", "Car", [12, 20]);
    expect(trackRangesOverlap(a, b)).toBe(false);
  });
});
