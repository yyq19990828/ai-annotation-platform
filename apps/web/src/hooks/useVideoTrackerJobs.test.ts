import { beforeEach, describe, expect, it, vi } from "vitest";

import { videoTrackerApi, type VideoTrackerJob } from "@/api/videoTracker";
import { TrackerJobStore, type TrackerStoreState } from "./useVideoTrackerJobs";

vi.mock("@/api/videoTracker", () => ({
  videoTrackerApi: {
    reviewable: vi.fn(),
    preview: vi.fn(),
    accept: vi.fn(),
    discard: vi.fn(),
    cancel: vi.fn(),
  },
}));

const reviewableJob: VideoTrackerJob = {
  id: "job-1",
  task_id: "task-1",
  dataset_item_id: "item-1",
  annotation_id: "annotation-1",
  segment_id: null,
  created_by: "user-1",
  status: "pending_review",
  model_key: "sam2_video",
  direction: "forward",
  from_frame: 0,
  to_frame: 10,
  prompt: {},
  event_channel: "video-tracker-job:job-1",
  celery_task_id: null,
  cancel_requested_at: null,
  started_at: null,
  completed_at: null,
  error_message: null,
  created_at: "2026-07-11T00:00:00Z",
  updated_at: null,
};

describe("TrackerJobStore.restoreReviewable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restores a pending candidate from the server after page state is lost", async () => {
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([reviewableJob]);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({
      job_id: "job-1",
      status: "pending_review",
      annotation_id: "annotation-1",
      results: [
        {
          frame_index: 1,
          geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        },
      ],
      grid_step: 1,
      output_geometry: "bbox",
    });
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1");

    expect(videoTrackerApi.reviewable).toHaveBeenCalledWith("task-1");
    expect(snapshot.jobs["job-1"]).toMatchObject({
      taskId: "task-1",
      annotationId: "annotation-1",
      status: "pending_review",
    });
    expect(snapshot.candidates["job-1"].results).toHaveLength(1);
  });

  it("does not restore a job whose staged preview is empty", async () => {
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([reviewableJob]);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({
      job_id: "job-1",
      status: "pending_review",
      annotation_id: "annotation-1",
      results: [],
      grid_step: 1,
      output_geometry: "bbox",
    });
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1");

    expect(snapshot.jobs).toEqual({});
    expect(snapshot.candidates).toEqual({});
  });
});
