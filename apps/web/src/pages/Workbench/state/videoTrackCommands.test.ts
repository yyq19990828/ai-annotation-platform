import { describe, expect, it } from "vitest";
import type { VideoTrackGeometry } from "@/types";
import { applyVideoKeyframeToGeometry, buildVideoKeyframeCommand } from "./videoTrackCommands";

const base: VideoTrackGeometry = {
  type: "video_track",
  track_id: "trk_1",
  keyframes: [
    { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
    { frame_index: 10, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
  ],
};

describe("videoTrackCommands", () => {
  it("builds a keyframe command when exactly one frame changes", () => {
    const after: VideoTrackGeometry = {
      ...base,
      keyframes: [
        base.keyframes[0],
        { frame_index: 10, bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
      ],
    };

    const cmd = buildVideoKeyframeCommand("ann-1", base, after);

    expect(cmd).toMatchObject({
      kind: "videoKeyframe",
      annotationId: "ann-1",
      frameIndex: 10,
      before: { frame_index: 10, bbox: { x: 0.4 } },
      after: { frame_index: 10, bbox: { x: 0.5 } },
    });
  });

  it("returns null when multiple keyframes change", () => {
    const after: VideoTrackGeometry = {
      ...base,
      keyframes: [
        { frame_index: 0, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
        { frame_index: 10, bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
      ],
    };

    expect(buildVideoKeyframeCommand("ann-1", base, after)).toBeNull();
  });

  it("applies a keyframe replacement without touching other frames", () => {
    const next = applyVideoKeyframeToGeometry(base, 10, {
      frame_index: 10,
      bbox: { x: 0.6, y: 0.2, w: 0.2, h: 0.2 },
      source: "manual",
      occluded: true,
    });

    expect(next.keyframes).toHaveLength(2);
    expect(next.keyframes[0]).toEqual(base.keyframes[0]);
    expect(next.keyframes[1].bbox.x).toBe(0.6);
    expect(next.keyframes[1].occluded).toBe(true);
  });

  it("applies a keyframe deletion", () => {
    const next = applyVideoKeyframeToGeometry(base, 10, null);

    expect(next.keyframes).toEqual([base.keyframes[0]]);
  });
});
