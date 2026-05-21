import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationResponse } from "@/types";
import { useVideoAnnotationActions } from "./useVideoAnnotationActions";

const apiMocks = vi.hoisted(() => ({
  composeVideoTracks: vi.fn(),
}));

vi.mock("@/api/tasks", () => ({
  tasksApi: apiMocks,
}));

const trackAnn: AnnotationResponse = {
  id: "ann-a",
  task_id: "task-1",
  project_id: "project-1",
  user_id: "user-1",
  source: "manual",
  annotation_type: "video_track",
  class_name: "Car",
  geometry: {
    type: "video_track",
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
  return result;
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
    const result = setup();
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
    const result = setup();
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
