import { describe, expect, it } from "vitest";
import { nearestTrackKeyframe, resolveTrackAtFrame, sortedKeyframes } from "./videoStageGeometry";
import type { VideoTrackGeometry } from "@/types";

function track(keyframes: VideoTrackGeometry["keyframes"]): VideoTrackGeometry {
  return {
    type: "video_track",
    track_id: "trk_1",
    keyframes,
  };
}

describe("videoStageGeometry", () => {
  it("resolves exact and interpolated frames from sorted keyframe indexes", () => {
    const geometry = track([
      { frame_index: 10, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
    ]);

    expect(sortedKeyframes(geometry).map((kf) => kf.frame_index)).toEqual([0, 10]);
    expect(resolveTrackAtFrame(geometry, 0)?.source).toBe("manual");
    expect(resolveTrackAtFrame(geometry, 5)?.geom).toEqual({
      x: 0.2,
      y: 0.2,
      w: 0.2,
      h: 0.2,
    });
  });

  it("does not interpolate across absent keyframes", () => {
    const geometry = track([
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 5, bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, source: "manual", absent: true },
      { frame_index: 10, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
    ]);

    expect(resolveTrackAtFrame(geometry, 5)).toBeNull();
    expect(resolveTrackAtFrame(geometry, 7)).toBeNull();
    expect(nearestTrackKeyframe(geometry, 6)?.frame_index).toBe(10);
  });
});
