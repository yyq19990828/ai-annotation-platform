import { describe, expect, it } from "vitest";
import type { VideoTrackGeometry } from "@/types";
import { deriveTrackNumber } from "./videoStageGeometry";

function track(id: string, trackId: string, firstFrame: number): { id: string; geometry: VideoTrackGeometry } {
  return {
    id,
    geometry: {
      type: "video_track",
      track_id: trackId,
      keyframes: [
        { frame_index: firstFrame, bbox: { x: 0, y: 0, w: 1, h: 1 }, source: "manual" },
        { frame_index: firstFrame + 5, bbox: { x: 0, y: 0, w: 1, h: 1 }, source: "manual" },
      ],
    },
  };
}

describe("deriveTrackNumber", () => {
  it("orders by first keyframe frame_index ascending", () => {
    const result = deriveTrackNumber([
      track("a", "trk_a", 10),
      track("b", "trk_b", 0),
      track("c", "trk_c", 5),
    ]);
    expect([...result.entries()]).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("breaks first-frame ties by track_id lexicographically", () => {
    const result = deriveTrackNumber([
      track("z", "trk_z", 0),
      track("a", "trk_a", 0),
    ]);
    expect(result.get("a")).toBe(1);
    expect(result.get("z")).toBe(2);
  });

  it("uses the minimum keyframe frame even when unsorted", () => {
    const x = {
      id: "x",
      geometry: {
        type: "video_track" as const,
        track_id: "trk_x",
        keyframes: [
          { frame_index: 8, bbox: { x: 0, y: 0, w: 1, h: 1 }, source: "manual" as const },
          { frame_index: 3, bbox: { x: 0, y: 0, w: 1, h: 1 }, source: "manual" as const },
        ],
      },
    };
    const result = deriveTrackNumber([x, track("y", "trk_y", 5)]);
    expect(result.get("x")).toBe(1);
    expect(result.get("y")).toBe(2);
  });

  it("returns an empty map for no tracks", () => {
    expect(deriveTrackNumber([]).size).toBe(0);
  });
});
