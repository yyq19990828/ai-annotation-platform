import { describe, expect, it } from "vitest";
import { pickTopVideoEntryAt } from "./videoStagePicking";
import type { VideoFrameEntry } from "./videoStageTypes";
import type { AnnotationResponse } from "@/types";

function entry(id: string, x: number): VideoFrameEntry {
  return {
    id,
    ann: { id, class_name: "car", geometry: { type: "video_bbox", frame_index: 0, x, y: 0.1, w: 0.3, h: 0.3 } } as AnnotationResponse,
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
    expect(pickTopVideoEntryAt([entry("box", 0.1)], { x: 0.09, y: 0.2 }, { padding: 0.02 })?.id).toBe("box");
  });
});
