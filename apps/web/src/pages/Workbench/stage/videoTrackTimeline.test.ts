import { describe, expect, it } from "vitest";
import type { VideoTrackGeometry } from "@/types";
import {
  buildGlobalTimelineDensity,
  buildSelectedTrackTimeline,
  firstAppearFrame,
  lastAppearFrame,
  nextKeyframeFrame,
  nextVisibleKeyframeFrame,
  prevKeyframeFrame,
  visibleKeyframesForTimeline,
} from "./videoTrackTimeline";

const bbox = { x: 0, y: 0, w: 0.2, h: 0.2 };

function track(patch: Partial<VideoTrackGeometry>): VideoTrackGeometry {
  return {
    type: "video_track",
    track_id: "trk",
    keyframes: [],
    ...patch,
  };
}

describe("videoTrackTimeline", () => {
  it("builds selected track timeline without interpolating across outside", () => {
    const timeline = buildSelectedTrackTimeline(track({
      outside: [{ from: 4, to: 5 }],
      keyframes: [
        { frame_index: 0, bbox, source: "manual" },
        { frame_index: 3, bbox, source: "prediction", occluded: true },
        { frame_index: 6, bbox, source: "manual" },
        { frame_index: 9, bbox, source: "manual" },
      ],
    }));

    expect(timeline.keyframes).toEqual([
      { frame: 0, source: "manual", occluded: false },
      { frame: 3, source: "prediction", occluded: true },
      { frame: 6, source: "manual", occluded: false },
      { frame: 9, source: "manual", occluded: false },
    ]);
    expect(timeline.outside).toEqual([{ from: 4, to: 5, source: "manual" }]);
    expect(timeline.interpolated).toEqual([
      { from: 0, to: 3, hasPrediction: true },
      { from: 6, to: 9, hasPrediction: false },
    ]);
  });

  it("filters outside keyframes from keyframe navigation", () => {
    const geometry = track({
      outside: [{ from: 5, to: 6 }, { from: 8, to: 8 }],
      keyframes: [
        { frame_index: 1, bbox, source: "manual" },
        { frame_index: 5, bbox, source: "manual" },
        { frame_index: 8, bbox, source: "manual" },
        { frame_index: 12, bbox, source: "prediction" },
      ],
    });

    expect(visibleKeyframesForTimeline(geometry).map((kf) => kf.frame_index)).toEqual([1, 12]);
    expect(nextVisibleKeyframeFrame(geometry, 1, 1)).toBe(12);
    expect(nextVisibleKeyframeFrame(geometry, 12, -1)).toBe(1);
    expect(nextVisibleKeyframeFrame(geometry, 12, 1)).toBeNull();
  });

  it("navigates prev/next keyframe and first/last appear over visible frames", () => {
    const geometry = track({
      outside: [{ from: 5, to: 6 }, { from: 8, to: 8 }],
      keyframes: [
        { frame_index: 1, bbox, source: "manual" },
        { frame_index: 5, bbox, source: "manual" },
        { frame_index: 8, bbox, source: "manual" },
        { frame_index: 12, bbox, source: "prediction" },
      ],
    });

    expect(nextKeyframeFrame(geometry, 1)).toBe(12);
    expect(nextKeyframeFrame(geometry, 12)).toBeNull();
    expect(prevKeyframeFrame(geometry, 12)).toBe(1);
    expect(prevKeyframeFrame(geometry, 1)).toBeNull();
    expect(firstAppearFrame(geometry)).toBe(1);
    expect(lastAppearFrame(geometry)).toBe(12);
  });

  it("returns null appear frames when no visible keyframe exists", () => {
    const geometry = track({
      outside: [{ from: 0, to: 10 }],
      keyframes: [{ frame_index: 3, bbox, source: "manual" }],
    });
    expect(firstAppearFrame(geometry)).toBeNull();
    expect(lastAppearFrame(geometry)).toBeNull();
    expect(prevKeyframeFrame(geometry, 5)).toBeNull();
    expect(nextKeyframeFrame(geometry, 0)).toBeNull();
  });

  it("aggregates global density into stable bins", () => {
    const bins = buildGlobalTimelineDensity([
      track({
        track_id: "a",
        keyframes: [
          { frame_index: 0, bbox, source: "manual" },
          { frame_index: 5, bbox, source: "manual" },
        ],
      }),
      track({
        track_id: "b",
        keyframes: [
          { frame_index: 5, bbox, source: "prediction" },
          { frame_index: 9, bbox, source: "manual" },
        ],
      }),
    ], 9, 5, [5, 6]);

    expect(bins).toEqual([
      { index: 0, from: 0, to: 1, density: 1 },
      { index: 1, from: 2, to: 3, density: 0 },
      { index: 2, from: 4, to: 5, density: 3 },
      { index: 3, from: 6, to: 7, density: 1 },
      { index: 4, from: 8, to: 9, density: 1 },
    ]);
  });
});
