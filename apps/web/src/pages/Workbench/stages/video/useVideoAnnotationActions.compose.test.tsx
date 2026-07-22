import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationResponse } from "@/types";
import { useVideoAnnotationActions } from "./useVideoAnnotationActions";

const apiMocks = vi.hoisted(() => ({
  composeVideoTracks: vi.fn(),
  uploadTaskContent: vi.fn(),
  saveMaskKeyframe: vi.fn(),
}));

vi.mock("@/api/tasks", () => ({
  tasksApi: apiMocks,
}));

vi.mock("@/api/rasterMasks", () => ({
  rasterMasksApi: { uploadTaskContent: apiMocks.uploadTaskContent },
}));

vi.mock("@/api/videoTracker", () => ({
  videoTrackerApi: { saveMaskKeyframe: apiMocks.saveMaskKeyframe },
}));

const trackAnn: AnnotationResponse = {
  id: "ann-a",
  task_id: "task-1",
  project_id: "project-1",
  user_id: "user-1",
  source: "manual",
  annotation_type: "video_track_bbox",
  class_name: "Car",
  geometry: {
    type: "video_track_bbox",
    track_id: "trk_a",
    keyframes: [{ frame_index: 0, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, source: "manual" }],
  },
  confidence: 1,
  parent_prediction_id: null,
  parent_annotation_id: null,
  lead_time: null,
  is_active: true,
  ground_truth: false,
  attributes: {},
  created_at: "2026-05-21T00:00:00Z",
  updated_at: null,
};

function setup() {
  const annotationsRef = { current: [trackAnn] as AnnotationResponse[] };
  const history = { push: vi.fn(), pushBatch: vi.fn() };
  const s = { setSelectedId: vi.fn() };
  const args = {
    taskId: "task-1",
    queryClient: new QueryClient(),
    history: history as never,
    s: s as never,
    annotationsRef,
    pushToast: vi.fn(),
    recordRecentClass: vi.fn(),
    optimisticEnqueueCreate: vi.fn(),
    enqueueOnError: vi.fn(),
    mutations: {
      create: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
    },
  };
  const { result } = renderHook(() => useVideoAnnotationActions(args as never));
  return { result, history, queryClient: args.queryClient };
}

describe("handleVideoComposeTracks gap_mode passthrough", () => {
  beforeEach(() => {
    apiMocks.composeVideoTracks.mockReset();
    apiMocks.composeVideoTracks.mockResolvedValue({
      operation: "join_tracks",
      updated_annotations: [],
      created_annotations: [],
      deleted_annotation_ids: [],
    });
  });

  it("forwards gapMode as gap_mode for join_tracks", async () => {
    const { result } = setup();
    await result.current.handleVideoComposeTracks({
      operation: "join_tracks",
      annotationIds: ["ann-a"],
      gapMode: "outside",
    });
    expect(apiMocks.composeVideoTracks).toHaveBeenCalledWith("task-1", {
      operation: "join_tracks",
      annotation_ids: ["ann-a"],
      frame_index: undefined,
      delete_sources: undefined,
      gap_mode: "outside",
    });
  });

  it("leaves gap_mode undefined for merge_tracks", async () => {
    const { result } = setup();
    await result.current.handleVideoComposeTracks({
      operation: "merge_tracks",
      annotationIds: ["ann-a"],
    });
    expect(apiMocks.composeVideoTracks).toHaveBeenCalledWith("task-1", {
      operation: "merge_tracks",
      annotation_ids: ["ann-a"],
      frame_index: undefined,
      delete_sources: undefined,
      gap_mode: undefined,
    });
  });
});

describe("handleVideoMaskCommit", () => {
  const digest = "a".repeat(64);
  const rle = {
    encoding: "coco_rle" as const,
    size: [2, 3] as [number, number],
    counts: [1, 2, 3],
  };
  const reference = {
    encoding: "coco_rle_ref" as const,
    size: [2, 3] as [number, number],
    object_key: `raster-masks/sha256/aa/aa/${digest}.json`,
    sha256: digest,
    runs: 3,
    bytes: 64,
  };
  const maskTrack: AnnotationResponse = {
    ...trackAnn,
    id: "mask-1",
    annotation_type: "video_track_mask",
    tool_unit_id: "region",
    version: 3,
    geometry: {
      type: "video_track_mask",
      track_id: "mask-track-1",
      keyframes: [{ frame_index: 1, mask: reference, source: "manual" }],
      outside: [],
    },
  };

  beforeEach(() => {
    apiMocks.uploadTaskContent.mockReset();
    apiMocks.saveMaskKeyframe.mockReset();
    apiMocks.uploadTaskContent.mockResolvedValue(reference);
    apiMocks.saveMaskKeyframe.mockResolvedValue({ ...maskTrack, version: 4 });
  });

  it("已有 Mask 轨迹走专用单帧 PUT 并采信服务端新版本", async () => {
    const { result, history, queryClient } = setup();
    queryClient.setQueryData(["annotations", "task-1"], [maskTrack]);

    const saved = await result.current.handleVideoMaskCommit(rle, 5, maskTrack);

    expect(apiMocks.uploadTaskContent).toHaveBeenCalledWith("task-1", rle);
    expect(apiMocks.saveMaskKeyframe).toHaveBeenCalledWith(
      "task-1",
      "mask-1",
      5,
      reference,
      3,
    );
    expect(saved).toMatchObject({
      annotation: { id: "mask-1", version: 4 },
      mask: reference,
      frameIndex: 5,
    });
    expect(history.push).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<AnnotationResponse[]>(["annotations", "task-1"])?.[0])
      .toMatchObject({ id: "mask-1", version: 4 });
  });

  it("版本缺失时在上传前稳定失败", async () => {
    const { result } = setup();

    await expect(result.current.handleVideoMaskCommit(
      rle,
      5,
      { ...maskTrack, version: undefined },
    )).rejects.toThrow("version is missing");
    expect(apiMocks.uploadTaskContent).not.toHaveBeenCalled();
    expect(apiMocks.saveMaskKeyframe).not.toHaveBeenCalled();
  });
});
