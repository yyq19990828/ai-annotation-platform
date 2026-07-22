import { describe, expect, it } from "vitest";
import type { AnnotationResponse, CocoRleMaskRef, VideoTrackMaskGeometry } from "@/types";
import type { CocoRle } from "./shared/geometry/maskRle";
import {
  buildVideoMaskCopyKeyframeRequest,
  validateVideoMaskClipboard,
  type VideoMaskClipboardEntry,
} from "./videoMaskClipboard";

const mask: CocoRleMaskRef = {
  encoding: "coco_rle_ref",
  size: [2, 3],
  object_key: "raster-masks/source.json",
  sha256: "a".repeat(64),
  runs: 3,
  bytes: 12,
};
const rle: CocoRle = { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 3] };

function annotation(
  id: string,
  version: number,
  geometry: VideoTrackMaskGeometry,
  className = "Car",
): AnnotationResponse {
  return {
    id,
    task_id: "task-1",
    project_id: "project-1",
    user_id: "user-1",
    source: "manual",
    annotation_type: "video_track_mask",
    tool_unit_id: "region",
    class_name: className,
    geometry,
    confidence: null,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    version,
    created_at: "2026-07-22T00:00:00Z",
    updated_at: null,
  };
}

function clipboard(source: AnnotationResponse): VideoMaskClipboardEntry {
  return {
    taskId: "task-1",
    sourceAnnotationId: source.id,
    sourceVersion: Number(source.version),
    sourceFrameIndex: 0,
    resolvedKeyframeFrame: 0,
    className: source.class_name,
    mask,
    rle,
  };
}

describe("videoMaskClipboard", () => {
  it("拒绝跨任务、过期版本与尺寸不一致的剪贴板", () => {
    const source = annotation("source", 3, {
      type: "video_track_mask",
      track_id: "trk_source",
      keyframes: [{ frame_index: 0, mask, source: "manual" }],
      outside: [],
    });
    const copied = clipboard(source);

    expect(validateVideoMaskClipboard(copied, {
      taskId: "task-2",
      source,
      width: 3,
      height: 2,
    })).toBe("剪贴板属于其他任务");
    expect(validateVideoMaskClipboard(copied, {
      taskId: "task-1",
      source: { ...source, version: 4 },
      width: 3,
      height: 2,
    })).toBe("复制来源已更新，请重新复制");
    expect(validateVideoMaskClipboard(copied, {
      taskId: "task-1",
      source,
      width: 2,
      height: 3,
    })).toBe("Mask 尺寸与当前视频不一致");
  });

  it("新轨粘贴把目标帧不可见的外部来源纳入版本指纹", async () => {
    const source = annotation("source", 3, {
      type: "video_track_mask",
      track_id: "trk_source",
      semantic_label: "vehicle-1",
      keyframes: [{ frame_index: 0, mask, source: "manual" }],
      outside: [{ from: 5, to: 20, source: "manual" }],
    });
    const visible = annotation("visible", 7, {
      type: "video_track_mask",
      track_id: "trk_visible",
      keyframes: [{ frame_index: 10, mask: { ...mask, object_key: "raster-masks/visible.json" }, source: "manual" }],
      outside: [],
    });

    const request = await buildVideoMaskCopyKeyframeRequest({
      clipboard: clipboard(source),
      annotations: [visible, source],
      source,
      frameIndex: 10,
      segmentId: "segment-1",
      idempotencyKey: "copy-1",
    });

    expect(request.operation).toBe("copy_keyframe");
    expect(request.source_frame_index).toBe(0);
    expect(request.scope).toMatchObject({ media: "video", frame_index: 10, segment_id: "segment-1" });
    expect(request.expected_versions).toEqual([
      { annotation_id: "source", version: 3 },
      { annotation_id: "visible", version: 7 },
    ]);
    expect(request.scope_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(request.mutations).toEqual([
      {
        kind: "create",
        source_annotation_ids: ["source"],
        geometry: expect.objectContaining({
          type: "video_track_mask",
          semantic_label: "vehicle-1",
          keyframes: [{ frame_index: 10, mask, source: "manual", occluded: false }],
          outside: [],
        }),
      },
    ]);
  });
});
