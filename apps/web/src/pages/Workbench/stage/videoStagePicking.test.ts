import { describe, expect, it } from "vitest";
import { pickTopVideoEntryAt, pickTopVideoMaskAt } from "./videoStagePicking";
import type { VideoFrameEntry } from "./videoStageTypes";
import type { AnnotationResponse } from "@/types";

function entry(id: string, x: number): VideoFrameEntry {
  return {
    id,
    ann: {
      id,
      class_name: "car",
      geometry: { type: "video_bbox", frame_index: 0, x, y: 0.1, w: 0.3, h: 0.3 },
    } as AnnotationResponse,
    geom: { x, y: 0.1, w: 0.3, h: 0.3 },
    className: "car",
    source: "legacy",
  };
}

describe("videoStagePicking", () => {
  it("returns the last rendered entry when boxes overlap", () => {
    const entries = [entry("bottom", 0.1), entry("top", 0.2)];
    expect(pickTopVideoEntryAt(entries, { x: 0.25, y: 0.2 })?.id).toBe("top");
  });

  it("supports small hit padding", () => {
    expect(pickTopVideoEntryAt([entry("box", 0.1)], { x: 0.09, y: 0.2 })).toBeNull();
    expect(
      pickTopVideoEntryAt([entry("box", 0.1)], { x: 0.09, y: 0.2 }, { padding: 0.02 })?.id,
    ).toBe("box");
  });

  it("uses true rotated-box hit area instead of its AABB", () => {
    const rotated = {
      id: "obb",
      geom: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      rotatedBbox: {
        type: "video_rotated_bbox" as const,
        frame_index: 0,
        cx: 0.5,
        cy: 0.5,
        w: 0.5,
        h: 0.1,
        angle: 45,
      },
    };
    const size = { w: 1000, h: 1000 };
    expect(pickTopVideoEntryAt([rotated], { x: 0.5, y: 0.5 }, { size })?.id).toBe("obb");
    expect(pickTopVideoEntryAt([rotated], { x: 0.3, y: 0.65 }, { size })).toBeNull();
  });

  it("hits only visible or occluded keypoint nodes", () => {
    const points = {
      id: "kp",
      geom: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
      keypoints: [
        { x: 0.2, y: 0.2, v: 2 as const },
        { x: 0.4, y: 0.4, v: 0 as const },
      ],
    };
    const size = { w: 1000, h: 1000 };
    expect(pickTopVideoEntryAt([points], { x: 0.202, y: 0.2 }, { size })?.id).toBe("kp");
    expect(pickTopVideoEntryAt([points], { x: 0.4, y: 0.4 }, { size })).toBeNull();
  });
});

describe("pickTopVideoMaskAt", () => {
  const record = (id: string, zOrder: number, alpha: number[]) => ({
    id,
    source: "annotation" as const,
    image: {} as CanvasImageSource,
    alpha: Uint8Array.from(alpha),
    width: 2,
    height: 2,
    geom: { x: 0, y: 0, w: 0.5, h: 0.5 },
    color: "#22c55e",
    zOrder,
    selected: false,
    isTrack: true,
    cacheKey: id,
  });

  it("uses row-major alpha and returns the top visible mask", () => {
    const low = record("low", 1, [255, 0, 0, 0]);
    const high = record("high", 2, [255, 0, 0, 0]);
    expect(pickTopVideoMaskAt([low, high], { x: 0.1, y: 0.1 })?.id).toBe("high");
    expect(pickTopVideoMaskAt([low, high], { x: 0.75, y: 0.1 })).toBeNull();
  });
});
