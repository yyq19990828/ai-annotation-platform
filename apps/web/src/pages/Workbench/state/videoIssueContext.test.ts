import { describe, expect, it } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { readVideoIssueContext } from "./videoIssueContext";

const read = (context: unknown, frame: unknown = 130) =>
  readVideoIssueContext({
    anchor_type: "pixel",
    annotation_id: null,
    anchor_position: { x: 0.3, y: 0.4, frame, video_context: context },
  } as AnnotationFeedback);

describe("persisted video Issue context", () => {
  it("keeps original object version evidence after a deleted annotation clears its foreign key", () => {
    expect(read({ schema_version: 1, annotation_version: 3 })).toEqual({
      schema_version: 1,
      annotation_version: 3,
    });
  });

  it.each([
    { schema_version: 2 },
    { schema_version: 1, viewport: { center_x: 0, center_y: 0 } },
    { schema_version: 1, viewport: { center_x: NaN, center_y: 0, zoom: 2 } },
    { schema_version: 1, viewport: { center_x: 0, center_y: 0, zoom: 0 } },
    { schema_version: 1, timeline_window: { from: 20, to: 10 } },
    { schema_version: 1, frame_range: { from_frame: 131, to_frame: 160 } },
    { schema_version: 1, frame_range: { from_frame: 120, to_frame: 129 } },
    { schema_version: 1, frame_range: { from_frame: "120", to_frame: 160 } },
    { schema_version: 1, annotation_version: true },
  ])("uses legacy fallback for invalid or unknown context %j", (context) => {
    expect(read(context)).toBeNull();
  });

  it("copies complete unbounded normalized views and fractional source windows", () => {
    const value = {
      schema_version: 1,
      viewport: { center_x: -0.2, center_y: 1.3, zoom: 2 },
      timeline_window: { from: 100.5, to: 170.2 },
      frame_range: { from_frame: 120, to_frame: 160 },
    };
    const restored = read(value);
    value.viewport.zoom = 10;
    expect(restored?.viewport?.zoom).toBe(2);
    expect(restored?.timeline_window).toEqual({ from: 100.5, to: 170.2 });
  });
});
