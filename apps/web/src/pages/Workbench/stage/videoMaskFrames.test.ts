import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationResponse } from "@/types";
import { buildTintedMaskRgba, maskAlphaBounds, useVideoMaskFrames } from "./videoMaskFrames";

const apiMocks = vi.hoisted(() => ({
  annotationRasterMaskContent: vi.fn(),
  annotationVideoMaskContent: vi.fn(),
}));

vi.mock("@/api/rasterMasks", () => ({
  rasterMasksApi: {
    annotationRasterMaskContent: apiMocks.annotationRasterMaskContent,
    annotationVideoMaskContent: apiMocks.annotationVideoMaskContent,
  },
}));

vi.mock("@/api/videoTracker", () => ({
  videoTrackerApi: { maskContent: vi.fn() },
}));

describe("video mask frame helpers", () => {
  it("builds a transparent RGBA overlay from row-major alpha", () => {
    expect([...buildTintedMaskRgba(Uint8Array.from([0, 255]), "#102030")]).toEqual([
      0, 0, 0, 0, 16, 32, 48, 255,
    ]);
  });

  it("computes normalized bounds without treating empty pixels as hits", () => {
    const alpha = Uint8Array.from([0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0]);
    expect(maskAlphaBounds(alpha, 4, 3)).toEqual({ x: 0.25, y: 1 / 3, w: 0.5, h: 2 / 3 });
    expect(maskAlphaBounds(new Uint8Array(4), 2, 2)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("useVideoMaskFrames", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    apiMocks.annotationRasterMaskContent.mockReset();
    apiMocks.annotationVideoMaskContent.mockReset();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: vi.fn() })),
    );
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
    );
  });

  it("单帧 video_mask 只在所属帧加载静态内容并归入人工对象", async () => {
    const digest = "a".repeat(64);
    const annotation = {
      id: "mask-frame",
      task_id: "task-1",
      project_id: "project-1",
      user_id: "user-1",
      source: "manual",
      annotation_type: "video_mask",
      class_name: "Car",
      geometry: {
        type: "video_mask",
        frame_index: 4,
        mask: {
          encoding: "coco_rle_ref",
          size: [2, 3],
          object_key: `raster-masks/sha256/aa/aa/${digest}.json`,
          sha256: digest,
          runs: 3,
          bytes: 64,
        },
      },
      confidence: 1,
      parent_prediction_id: null,
      parent_annotation_id: null,
      lead_time: null,
      is_active: true,
      ground_truth: false,
      version: 1,
      created_at: "2026-07-23T00:00:00Z",
      updated_at: null,
    } satisfies AnnotationResponse;
    apiMocks.annotationRasterMaskContent.mockResolvedValue({
      encoding: "coco_rle",
      size: [2, 3],
      counts: [1, 2, 3],
    });

    const { result, rerender } = renderHook(
      ({ frameIndex }) =>
        useVideoMaskFrames({
          taskId: "task-1",
          annotations: [annotation],
          candidates: [],
          frameIndex,
          selectedId: annotation.id,
          colorForAnnotation: () => "#ff0000",
        }),
      { initialProps: { frameIndex: 4 } },
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({
      id: annotation.id,
      selected: true,
      isTrack: false,
    });
    expect(apiMocks.annotationRasterMaskContent).toHaveBeenCalledWith(annotation.id);
    expect(apiMocks.annotationVideoMaskContent).not.toHaveBeenCalled();

    rerender({ frameIndex: 5 });
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
