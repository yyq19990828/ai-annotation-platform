import { describe, expect, it } from "vitest";
import type { MaskMutationScope } from "@/api/maskMutations";
import type { AnnotationResponse, Geometry } from "@/types";
import {
  maskMutationExpectedVersions,
  maskAlphasIntersect,
  maskMutationScopeFingerprint,
  maskMutationScopeMembers,
  subtractMaskAlpha,
} from "./maskMutationDraft";

const maskRef = {
  encoding: "coco_rle_ref" as const,
  size: [2, 3] as [number, number],
  object_key: "raster-masks/test.json",
  sha256: "a".repeat(64),
  runs: 3,
  bytes: 12,
};

function annotation(
  id: string,
  geometry: Geometry,
  options: Partial<AnnotationResponse> = {},
): AnnotationResponse {
  return {
    id,
    task_id: "task-1",
    project_id: "project-1",
    user_id: "user-1",
    source: "manual",
    annotation_type: geometry.type,
    class_name: "object",
    geometry,
    confidence: null,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    version: 1,
    created_at: "2026-07-22T00:00:00Z",
    updated_at: null,
    ...options,
  };
}

const imageScope: MaskMutationScope = {
  media: "image",
  frame_index: null,
  segment_id: null,
  instance_filter: "same_class",
  class_name: "object",
  overlap_policy: "allow",
  strict_non_overlap: false,
};

describe("maskMutationDraft", () => {
  it("固定 scope 成员顺序并与后端 canonical digest 一致", async () => {
    const first = annotation(
      "00000000-0000-0000-0000-000000000001",
      { type: "raster_mask", mask: maskRef },
      { version: 2 },
    );
    const second = annotation(
      "00000000-0000-0000-0000-000000000002",
      { type: "raster_mask", mask: maskRef },
      { version: 3 },
    );
    const ignored = annotation("tmp_local", { type: "raster_mask", mask: maskRef }, { version: 4 });

    const members = maskMutationScopeMembers([second, ignored, first], imageScope);

    expect(members.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(maskMutationExpectedVersions(members)).toEqual([
      { annotation_id: first.id, version: 2 },
      { annotation_id: second.id, version: 3 },
    ]);
    expect(await maskMutationScopeFingerprint(imageScope, members)).toBe(
      "f2504908ebe243d38145a554e42d14fb259f890290a45a91839b36ee21388e87",
    );
  });

  it("视频 scope 只收集当前帧可见 Mask 轨迹", () => {
    const visible = annotation("visible", {
      type: "video_track_mask",
      track_id: "trk_visible",
      keyframes: [{ frame_index: 2, mask: maskRef, source: "manual" }],
      outside: [],
    });
    const outside = annotation("outside", {
      type: "video_track_mask",
      track_id: "trk_outside",
      keyframes: [{ frame_index: 2, mask: maskRef, source: "manual" }],
      outside: [{ from: 2, to: 4, source: "manual" }],
    });
    const scope: MaskMutationScope = {
      ...imageScope,
      media: "video",
      frame_index: 3,
      segment_id: "00000000-0000-0000-0000-000000000010",
    };

    expect(maskMutationScopeMembers([outside, visible], scope).map((item) => item.id)).toEqual([
      "visible",
    ]);
  });

  it("拒绝无有效版本的范围成员", () => {
    const invalid = annotation(
      "00000000-0000-0000-0000-000000000001",
      { type: "raster_mask", mask: maskRef },
      { version: undefined },
    );
    expect(() => maskMutationExpectedVersions([invalid])).toThrow("缺少有效版本");
  });

  it("像素扣除返回变化量和剩余面积", () => {
    const result = subtractMaskAlpha(
      new Uint8Array([255, 255, 0, 255]),
      new Uint8Array([0, 255, 255, 255]),
    );
    expect(Array.from(result.alpha)).toEqual([255, 0, 0, 0]);
    expect(result.changedPixels).toBe(2);
    expect(result.area).toBe(1);
  });

  it("检测范围内任意两个最终 Mask 的像素重叠", () => {
    expect(maskAlphasIntersect(new Uint8Array([255, 0, 255]), new Uint8Array([0, 255, 255]))).toBe(
      true,
    );
    expect(maskAlphasIntersect(new Uint8Array([255, 0]), new Uint8Array([0, 255]))).toBe(false);
  });
});
