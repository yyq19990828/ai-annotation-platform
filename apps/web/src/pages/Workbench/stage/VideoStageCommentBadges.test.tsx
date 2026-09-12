import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationResponse } from "@/types";
import { DEFAULT_ANNOTATION_VISUAL } from "./annotationVisual";
import type { VideoEntryView } from "./videoFrameViews";
import { deriveVideoFrameViews } from "./videoFrameViews";
import {
  buildVideoAnnotationCommentBadges,
  VideoStageCommentBadges,
} from "./VideoStageCommentBadges";

const view = { scale: 2, tx: 10, ty: 20 };

function entry(id: string, overrides: Partial<VideoEntryView> = {}): VideoEntryView {
  return {
    key: id,
    id,
    geom: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    color: "#fff",
    selected: false,
    dashed: false,
    occluded: false,
    predicted: false,
    labelText: id,
    className: "car",
    ...overrides,
  };
}

function annotation(id: string, overrides: Partial<AnnotationResponse> = {}) {
  return {
    id,
    task_id: "task-1",
    project_id: "project-1",
    user_id: "user-1",
    source: "manual",
    annotation_type: "video_bbox",
    class_name: "car",
    geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    confidence: null,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    ...overrides,
  } as AnnotationResponse;
}

describe("VideoStageCommentBadges", () => {
  it("follows real frame derivation: single-frame objects disappear, tracks interpolate, outside hides", () => {
    const single = annotation("single");
    const track = annotation("track", {
      annotation_type: "video_track_bbox",
      geometry: {
        type: "video_track_bbox",
        track_id: "track-1",
        keyframes: [
          { frame_index: 0, bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, source: "manual" },
          { frame_index: 2, bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
        ],
      },
    });
    const outside = annotation("outside", {
      annotation_type: "video_track_bbox",
      geometry: {
        type: "video_track_bbox",
        track_id: "track-2",
        outside: [{ from: 1, to: 1 }],
        keyframes: [
          { frame_index: 0, bbox: { x: 0.5, y: 0.2, w: 0.2, h: 0.2 }, source: "manual" },
          { frame_index: 2, bbox: { x: 0.6, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
        ],
      },
    });
    const annotations = [single, track, outside];
    const frame0 = deriveVideoFrameViews({
      annotations,
      frameIndex: 0,
      selectedId: null,
      visual: DEFAULT_ANNOTATION_VISUAL,
    });
    const frame1 = deriveVideoFrameViews({
      annotations,
      frameIndex: 1,
      selectedId: null,
      visual: DEFAULT_ANNOTATION_VISUAL,
    });
    expect(frame0.entries.map(({ id }) => id)).toEqual(["single", "track", "outside"]);
    expect(frame1.entries.map(({ id }) => id)).toEqual(["track"]);
    expect(frame1.entries[0]?.dashed).toBe(true);
    expect(frame1.entries[0]?.geom.x).toBeCloseTo(0.2);
    expect(frame1.entries[0]?.geom.y).toBeCloseTo(0.3);
    expect(
      buildVideoAnnotationCommentBadges({
        entries: frame1.entries,
        annotations,
        counts: { single: 1, track: 1, outside: 1 },
        imgW: 100,
        imgH: 80,
        vp: view,
      }).map(({ id }) => id),
    ).toEqual(["track"]);
  });

  it("anchors current-frame single and track geometry, including point paths", () => {
    const models = buildVideoAnnotationCommentBadges({
      entries: [
        entry("bbox"),
        entry("polygon", {
          points: [
            [0.4, 0.5],
            [0.8, 0.5],
            [0.7, 0.8],
          ],
        }),
        entry("polyline", {
          points: [
            [0.2, 0.4],
            [0.6, 0.7],
          ],
          open: true,
        }),
        entry("rotated", {
          rotatedBbox: {
            type: "video_rotated_bbox",
            frame_index: 0,
            cx: 0.5,
            cy: 0.5,
            w: 0.2,
            h: 0.2,
            angle: 45,
          },
        }),
        entry("keypoint", {
          keypoints: [
            { x: 0.2, y: 0.2, v: 0 },
            { x: 0.7, y: 0.6, v: 2 },
          ],
        }),
        entry("keypoint-hidden", {
          keypoints: [{ x: 0.8, y: 0.8, v: 0 }],
        }),
        entry("track-held", { dashed: true }),
      ],
      counts: {
        bbox: 1,
        polygon: 2,
        polyline: 3,
        rotated: 4,
        keypoint: 5,
        "keypoint-hidden": 7,
        "track-held": 6,
      },
      imgW: 100,
      imgH: 80,
      vp: view,
    });
    expect(models.map(({ id, count }) => ({ id, count }))).toEqual([
      { id: "bbox", count: 1 },
      { id: "polygon", count: 2 },
      { id: "polyline", count: 3 },
      { id: "rotated", count: 4 },
      { id: "keypoint", count: 5 },
      { id: "track-held", count: 6 },
    ]);
    expect(models.find((model) => model.id === "keypoint")).toMatchObject({
      left: 178,
      top: 88,
    });
  });

  it("uses loaded mask bounds and excludes hidden or inactive objects", () => {
    const models = buildVideoAnnotationCommentBadges({
      entries: [entry("hidden"), entry("inactive"), entry("current")],
      maskRecords: [{ id: "mask", geom: { x: 0.4, y: 0.25, w: 0.1, h: 0.2 } }],
      annotations: [
        annotation("hidden", { is_hidden: true }),
        annotation("inactive", { is_active: false }),
      ],
      counts: { hidden: 1, inactive: 1, current: 1, mask: 10, unloaded: 4 },
      imgW: 1000,
      imgH: 800,
      vp: view,
    });
    expect(models.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "current", label: "1" },
      { id: "mask", label: "9+" },
    ]);
  });

  it("opens the guarded shell callback and disables targets during playback or drawing", () => {
    const open = vi.fn();
    const props = {
      entries: [entry("ann-1")],
      counts: { "ann-1": 1 },
      imgW: 100,
      imgH: 80,
      vp: view,
      onOpenAnnotationComments: open,
    };
    const { rerender } = render(<VideoStageCommentBadges {...props} />);
    const badge = screen.getByRole("button", { name: "标注 ann-1 有 1 条评论" });
    fireEvent.pointerDown(badge);
    fireEvent.click(badge);
    expect(open).toHaveBeenCalledWith("ann-1");

    rerender(<VideoStageCommentBadges {...props} counts={undefined} />);
    expect(screen.queryByTestId("annotation-comment-badges")).toBeNull();
    rerender(<VideoStageCommentBadges {...props} />);
    expect(screen.getByRole("button", { name: "标注 ann-1 有 1 条评论" })).toBeEnabled();

    rerender(<VideoStageCommentBadges {...props} interactive={false} />);
    expect(screen.getByRole("button", { name: "标注 ann-1 有 1 条评论" })).toBeDisabled();
  });
});
