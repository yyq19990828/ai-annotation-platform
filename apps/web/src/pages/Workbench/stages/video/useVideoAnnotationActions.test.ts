import { describe, expect, it } from "vitest";
import type { AnnotationResponse, VideoTrackGeometry } from "@/types";
import { buildVideoCreatePayload, buildVideoUpdateCommand } from "./useVideoAnnotationActions";

const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

function annotation(geometry: AnnotationResponse["geometry"]): AnnotationResponse {
  return {
    id: "ann-1",
    task_id: "task-1",
    project_id: "project-1",
    user_id: "user-1",
    source: "manual",
    annotation_type: geometry.type,
    class_name: "Car",
    geometry,
    confidence: 1,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    attributes: {},
    created_at: "2026-05-11T00:00:00Z",
    updated_at: null,
  };
}

describe("video annotation actions helpers", () => {
  it("builds video_bbox create payload", () => {
    const payload = buildVideoCreatePayload("video_bbox", 7, box, "Car");

    expect(payload).toEqual({
      annotation_type: "video_bbox",
      class_name: "Car",
      geometry: { type: "video_bbox", frame_index: 7, ...box },
    });
  });

  it("builds video_track create payload with one manual keyframe", () => {
    const payload = buildVideoCreatePayload("video_track", 9, box, "");

    expect(payload.annotation_type).toBe("video_track");
    expect(payload.class_name).toBe("__unknown");
    expect(payload.geometry.type).toBe("video_track");
    const geometry = payload.geometry as VideoTrackGeometry;
    expect(geometry.track_id).toMatch(/^trk_/);
    expect(geometry.keyframes).toEqual([
      {
        frame_index: 9,
        bbox: box,
        source: "manual",
        absent: false,
        occluded: false,
      },
    ]);
  });

  it("uses videoKeyframe history command for single-keyframe track edits", () => {
    const before: VideoTrackGeometry = {
      type: "video_track",
      track_id: "trk_1",
      keyframes: [{ frame_index: 0, bbox: box, source: "manual" }],
    };
    const after: VideoTrackGeometry = {
      ...before,
      keyframes: [...before.keyframes, { frame_index: 5, bbox: { x: 0.2, y: 0.2, w: 0.3, h: 0.4 }, source: "manual" }],
    };

    expect(buildVideoUpdateCommand(annotation(before), after)).toMatchObject({
      kind: "videoKeyframe",
      annotationId: "ann-1",
      frameIndex: 5,
    });
  });

  it("falls back to full geometry update for video_bbox edits", () => {
    const ann = annotation({ type: "video_bbox", frame_index: 1, ...box });
    const after = { type: "video_bbox" as const, frame_index: 1, x: 0.2, y: 0.2, w: 0.3, h: 0.4 };

    expect(buildVideoUpdateCommand(ann, after)).toEqual({
      kind: "update",
      annotationId: "ann-1",
      before: { geometry: ann.geometry },
      after: { geometry: after },
    });
  });
});
