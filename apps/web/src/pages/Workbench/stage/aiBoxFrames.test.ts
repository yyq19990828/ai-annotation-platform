import { describe, expect, it } from "vitest";
import type { AiBox } from "../state/transforms";
import {
  adjacentPredictedFrame,
  aiBoxOnFrame,
  collectPredictedFrames,
  dedupeAiBoxesById,
  resolveAiBoxAtFrame,
} from "./aiBoxFrames";

const bbox = { x: 0, y: 0, w: 0.2, h: 0.2 };

function bboxBox(id: string, frameIndex: number): AiBox {
  return { id, geometry: { type: "video_bbox", frame_index: frameIndex, bbox } } as unknown as AiBox;
}

function trackBox(id: string, frames: number[]): AiBox {
  return {
    id,
    geometry: {
      type: "video_track_bbox",
      track_id: id,
      keyframes: frames.map((frame_index) => ({ frame_index, bbox, source: "prediction" })),
    },
  } as unknown as AiBox;
}

describe("aiBoxFrames", () => {
  it("collects predicted frames from video_bbox frame_index", () => {
    const frames = collectPredictedFrames([bboxBox("pred-1-0", 3), bboxBox("pred-2-0", 1)]);
    expect(frames).toEqual([1, 3]);
  });

  it("collects predicted frames from video_track_bbox keyframes", () => {
    const frames = collectPredictedFrames([trackBox("pred-9-0", [0, 10, 5])]);
    expect(frames).toEqual([0, 5, 10]);
  });

  it("dedupes by id before collecting (offset-pagination overlap)", () => {
    const dup = bboxBox("pred-1-0", 3);
    const frames = collectPredictedFrames([dup, dup, bboxBox("pred-1-0", 3)]);
    expect(frames).toEqual([3]);
    expect(dedupeAiBoxesById([dup, dup])).toHaveLength(1);
  });

  it("finds adjacent predicted frame in both directions", () => {
    const frames = [1, 3, 7];
    expect(adjacentPredictedFrame(frames, 3, 1)).toBe(7);
    expect(adjacentPredictedFrame(frames, 3, -1)).toBe(1);
    expect(adjacentPredictedFrame(frames, 7, 1)).toBeNull();
    expect(adjacentPredictedFrame(frames, 1, -1)).toBeNull();
  });

  it("aiBoxOnFrame matches video_bbox by exact frame", () => {
    const box = bboxBox("pred-1-0", 4);
    expect(aiBoxOnFrame(box, 4)).toBe(true);
    expect(aiBoxOnFrame(box, 5)).toBe(false);
  });

  it("aiBoxOnFrame matches video_track_bbox on interpolated frames", () => {
    const box = trackBox("pred-9-0", [0, 10]);
    expect(aiBoxOnFrame(box, 0)).toBe(true);
    expect(aiBoxOnFrame(box, 5)).toBe(true); // interpolated between keyframes
    expect(aiBoxOnFrame(box, 20)).toBe(false); // beyond last keyframe
  });

  it("resolveAiBoxAtFrame returns video_bbox as-is on its frame, null otherwise", () => {
    const box = bboxBox("pred-1-0", 4);
    expect(resolveAiBoxAtFrame(box, 4)).toBe(box);
    expect(resolveAiBoxAtFrame(box, 5)).toBeNull();
  });

  it("resolveAiBoxAtFrame overrides track x/y/w/h with the current-frame geometry", () => {
    const box = trackBox("pred-9-0", [0, 10]);
    const resolved = resolveAiBoxAtFrame(box, 0);
    expect(resolved).not.toBeNull();
    // 顶层坐标被解出的当前帧框覆盖 (关键帧 0 的 bbox = {0,0,0.2,0.2})
    expect({ x: resolved!.x, y: resolved!.y, w: resolved!.w, h: resolved!.h }).toEqual(bbox);
    expect(resolveAiBoxAtFrame(box, 20)).toBeNull();
  });
});
