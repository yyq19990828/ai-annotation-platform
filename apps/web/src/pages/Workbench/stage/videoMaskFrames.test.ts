import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationResponse } from "@/types";
import type { AiBox } from "../state/transforms";
import { buildTintedMaskRgba, maskAlphaBounds, useVideoMaskFrames } from "./videoMaskFrames";

const apiMocks = vi.hoisted(() => ({
  annotationRasterMaskContent: vi.fn(),
  annotationVideoMaskContent: vi.fn(),
  predictionVideoMaskContent: vi.fn(),
}));

vi.mock("@/api/rasterMasks", () => ({
  rasterMasksApi: {
    annotationRasterMaskContent: apiMocks.annotationRasterMaskContent,
    annotationVideoMaskContent: apiMocks.annotationVideoMaskContent,
    predictionVideoMaskContent: apiMocks.predictionVideoMaskContent,
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
    apiMocks.predictionVideoMaskContent.mockReset();
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
          predictions: [],
          frameIndex,
          selectedId: annotation.id,
          colorForAnnotation: () => "#ff0000",
          colorForPrediction: () => "#00ff00",
        }),
      { initialProps: { frameIndex: 4 } },
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({
      id: annotation.id,
      selected: true,
      isTrack: false,
      color: "#ff0000",
    });
    const rendered = vi.mocked(createImageBitmap).mock.calls[0][0] as ImageData;
    expect(rendered.width * rendered.height).toBeLessThan(3 * 2);
    expect(apiMocks.annotationRasterMaskContent).toHaveBeenCalledWith(annotation.id);
    expect(apiMocks.annotationVideoMaskContent).not.toHaveBeenCalled();

    rerender({ frameIndex: 5 });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("外部 video_track_mask 候选复用任务鉴权内容端点并保持 AI 选择 id", async () => {
    const digest = "b".repeat(64);
    const reference = {
      encoding: "coco_rle_ref" as const,
      size: [2, 3] as [number, number],
      object_key: `raster-masks/sha256/bb/bb/${digest}.json`,
      sha256: digest,
      runs: 3,
      bytes: 64,
    };
    const prediction = {
      id: "pred-p1-0",
      predictionId: "p1",
      shapeIndex: 0,
      cls: "Car",
      geometry: {
        type: "video_track_mask",
        track_id: "mask-track",
        keyframes: [{ frame_index: 1, mask: reference, source: "prediction" }],
        outside: [{ from: 8, to: 9, source: "prediction" }],
      },
    } as AiBox;
    apiMocks.predictionVideoMaskContent.mockResolvedValue({
      encoding: "coco_rle",
      size: [2, 3],
      counts: [1, 2, 3],
    });

    const { result, rerender } = renderHook(
      ({ frameIndex }) =>
        useVideoMaskFrames({
          taskId: "task-1",
          annotations: [],
          candidates: [],
          predictions: [prediction],
          frameIndex,
          selectedId: prediction.id,
          colorForAnnotation: () => "#ff0000",
          colorForPrediction: () => "#00ff00",
        }),
      { initialProps: { frameIndex: 5 } },
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({
      id: prediction.id,
      source: "prediction",
      selected: true,
      isTrack: true,
      color: "#00ff00",
    });
    expect(apiMocks.predictionVideoMaskContent).toHaveBeenCalledWith("task-1", "p1", 0, 5);

    rerender({ frameIndex: 8 });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("版本切换后先让 Konva 提交新 Mask，再释放旧 ImageBitmap", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    class FakeImageBitmap {
      width = 2;
      height = 2;
      close = vi.fn(() => {
        this.width = 0;
        this.height = 0;
      });
    }
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => new FakeImageBitmap()),
    );
    apiMocks.annotationVideoMaskContent.mockResolvedValue({
      encoding: "coco_rle",
      size: [2, 3],
      counts: [1, 2, 3],
    });
    const colorForAnnotation = () => "#ff0000";
    const colorForPrediction = () => "#00ff00";
    const annotation = (version: number) =>
      ({
        id: "mask-track",
        task_id: "task-1",
        project_id: "project-1",
        user_id: "user-1",
        source: "manual",
        annotation_type: "video_track_mask",
        class_name: "Car",
        geometry: {
          type: "video_track_mask",
          track_id: "track-1",
          keyframes: [
            {
              frame_index: 1,
              mask: {
                encoding: "coco_rle_ref",
                size: [2, 3],
                object_key: `raster-masks/sha256/aa/aa/${"a".repeat(64)}.json`,
                sha256: "a".repeat(64),
                runs: 3,
                bytes: 64,
              },
              source: "manual",
            },
          ],
        },
        confidence: 1,
        parent_prediction_id: null,
        parent_annotation_id: null,
        lead_time: null,
        is_active: true,
        ground_truth: false,
        version,
        created_at: "2026-07-23T00:00:00Z",
        updated_at: null,
      }) satisfies AnnotationResponse;

    const { result, rerender } = renderHook(
      ({ value }) =>
        useVideoMaskFrames({
          taskId: "task-1",
          annotations: [value],
          candidates: [],
          predictions: [],
          frameIndex: 1,
          selectedId: value.id,
          colorForAnnotation,
          colorForPrediction,
        }),
      { initialProps: { value: annotation(1) } },
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    const firstBitmap = result.current[0].image as unknown as FakeImageBitmap;
    rerender({ value: annotation(2) });
    await waitFor(() => expect(result.current[0]?.cacheKey).toContain("version:2"));

    expect(firstBitmap.close).not.toHaveBeenCalled();
    act(() => {
      for (const callback of animationFrames.splice(0)) callback(performance.now());
    });
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
  });
});
