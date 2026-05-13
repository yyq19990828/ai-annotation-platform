import { describe, expect, it } from "vitest";
import type { VideoTrackGeometry } from "@/types";
import {
  addOutsideRange,
  effectiveOutsideRanges,
  isFrameOutside,
  normalizeOutsideRanges,
  removeOutsideFrame,
} from "./videoTrackOutside";

const track: VideoTrackGeometry = {
  type: "video_track",
  track_id: "trk",
  keyframes: [
    { frame_index: 2, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "manual", absent: true },
    { frame_index: 8, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "manual" },
  ],
};

describe("videoTrackOutside", () => {
  it("normalizes outside ranges by sorting and merging adjacent ranges", () => {
    expect(normalizeOutsideRanges([
      { from: 7, to: 8 },
      { from: 3, to: 4 },
      { from: 5, to: 6 },
      { from: 12, to: 10, source: "prediction" },
    ])).toEqual([
      { from: 3, to: 8, source: "manual" },
      { from: 10, to: 12, source: "prediction" },
    ]);
  });

  it("combines explicit outside ranges with legacy absent keyframes", () => {
    const ranges = effectiveOutsideRanges({
      ...track,
      outside: [{ from: 4, to: 5 }],
    });

    expect(ranges).toEqual([
      { from: 2, to: 2, source: "manual" },
      { from: 4, to: 5, source: "manual" },
    ]);
    expect(isFrameOutside({ ...track, outside: [{ from: 4, to: 5 }] }, 4)).toBe(true);
    expect(isFrameOutside({ ...track, outside: [{ from: 4, to: 5 }] }, 8)).toBe(false);
  });

  it("adds and removes a single frame from explicit outside ranges", () => {
    const withOutside = addOutsideRange(track, { from: 3, to: 8 });

    expect(withOutside.outside).toEqual([{ from: 3, to: 8, source: "manual" }]);
    expect(removeOutsideFrame(withOutside, 5).outside).toEqual([
      { from: 3, to: 4, source: "manual" },
      { from: 6, to: 8, source: "manual" },
    ]);
  });
});
