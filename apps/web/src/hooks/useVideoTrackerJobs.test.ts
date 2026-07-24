import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { videoTrackerApi, type VideoTrackerJob } from "@/api/videoTracker";
import { ApiError } from "@/api/client";
import { TrackerJobStore, type TrackerStoreState } from "./useVideoTrackerJobs";

vi.mock("@/api/videoTracker", () => ({
  videoTrackerApi: {
    reviewable: vi.fn(),
    active: vi.fn(),
    preview: vi.fn(),
    get: vi.fn(),
    decide: vi.fn(),
    accept: vi.fn(),
    discard: vi.fn(),
    cancel: vi.fn(),
  },
}));

// jsdom 不提供 WebSocket。用最小 mock 捕获 connect() 的 URL 与 close() 调用,
// 以断言运行中任务的重连 (#10) 与切任务时旧 socket 的关闭 (#9)。
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const reviewableJob: VideoTrackerJob = {
  id: "job-1",
  task_id: "task-1",
  dataset_item_id: "item-1",
  annotation_id: "annotation-1",
  segment_id: null,
  created_by: "user-1",
  status: "pending_review",
  revision: 1,
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

const runningJob: VideoTrackerJob = {
  ...reviewableJob,
  id: "job-run-1",
  status: "running",
  annotation_id: "annotation-2",
};

const runningCorrectionJob: VideoTrackerJob = {
  ...runningJob,
  id: "job-correction-1",
  annotation_id: "annotation-1",
  job_kind: "correction",
  correction_frame: 5,
};

const reviewableCorrectionJob: VideoTrackerJob = {
  ...runningCorrectionJob,
  status: "pending_review",
};

const stagedPreview: import("@/api/videoTracker").VideoTrackerJobPreview = {
  job_id: reviewableJob.id,
  status: reviewableJob.status,
  annotation_id: reviewableJob.annotation_id,
  results: [
    {
      frame_index: 1,
      instance_id: "1",
      geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    },
  ],
  grid_step: 1,
  output_geometry: "bbox",
  job_revision: 1,
  expected_source_versions: { "annotation-1": 1 },
  candidate_total: 2,
  candidate_pending: 1,
  candidate_accepted: 0,
  candidate_rejected: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  // 两路拉取默认空,单测按需覆盖其一。
  vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([]);
  vi.mocked(videoTrackerApi.active).mockResolvedValue([]);
  vi.mocked(videoTrackerApi.get).mockResolvedValue(reviewableJob);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("TrackerJobStore.restoreReviewable", () => {
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
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
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

  it("preview 为空时保留作业以供轮询确认", async () => {
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
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1");

    expect(snapshot.jobs["job-1"]?.status).toBe("pending_review");
    expect(snapshot.candidates).toEqual({});
    await store.restoreReviewable("task-2");
  });
});

describe("TrackerJobStore.restoreReviewable · 重连运行中任务 (#10)", () => {
  it("恢复运行中任务到 UI 并按 token 重连 WebSocket", async () => {
    vi.mocked(videoTrackerApi.active).mockResolvedValue([runningJob]);
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1", "tok-abc");

    expect(videoTrackerApi.active).toHaveBeenCalledWith("task-1");
    expect(snapshot.jobs["job-run-1"]).toMatchObject({
      taskId: "task-1",
      status: "running",
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/ws/video-tracker-jobs/job-run-1");
    expect(MockWebSocket.instances[0].url).toContain("token=tok-abc");
  });

  it("无 token 时仍恢复运行中任务到 UI, 但不重连 WebSocket", async () => {
    vi.mocked(videoTrackerApi.active).mockResolvedValue([runningJob]);
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1");

    expect(snapshot.jobs["job-run-1"]?.status).toBe("running");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("无 token 时轮询到终态并恢复纠错候选", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(videoTrackerApi.active).mockResolvedValue([runningCorrectionJob]);
      vi.mocked(videoTrackerApi.get).mockResolvedValue(reviewableCorrectionJob);
      vi.mocked(videoTrackerApi.preview).mockResolvedValue({
        ...stagedPreview,
        job_id: runningCorrectionJob.id,
        job_kind: "correction",
        correction_frame: 5,
      });
      const store = new TrackerJobStore();
      let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
      store.subscribe((next) => {
        snapshot = next;
      });

      await store.restoreReviewable("task-1");
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
      await Promise.resolve();

      expect(videoTrackerApi.get).toHaveBeenCalledWith("job-correction-1");
      expect(videoTrackerApi.preview).toHaveBeenCalledWith("job-correction-1");
      expect(snapshot.jobs["job-correction-1"]?.status).toBe("pending_review");
      expect(snapshot.candidates["job-correction-1"]?.results).toHaveLength(1);
      await store.restoreReviewable("task-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("WebSocket 断开后轮询恢复作业状态", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(videoTrackerApi.active).mockResolvedValue([runningCorrectionJob]);
      vi.mocked(videoTrackerApi.get).mockResolvedValue({
        ...runningCorrectionJob,
        status: "running",
      });
      const store = new TrackerJobStore();
      await store.restoreReviewable("task-1", "tok-abc");
      expect(MockWebSocket.instances).toHaveLength(1);

      MockWebSocket.instances[0].onclose?.();
      await vi.advanceTimersByTimeAsync(2000);

      expect(videoTrackerApi.get).toHaveBeenCalledWith("job-correction-1");
      await store.restoreReviewable("task-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reviewable 拉取失败不阻断运行中任务的重连", async () => {
    vi.mocked(videoTrackerApi.reviewable).mockRejectedValue(new Error("boom"));
    vi.mocked(videoTrackerApi.active).mockResolvedValue([runningJob]);
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1", "tok-abc");

    expect(snapshot.jobs["job-run-1"]?.status).toBe("running");
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe("TrackerJobStore.cancel · Mask 纠错", () => {
  it("取消成功后立即移除候选并保留终态", async () => {
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([reviewableCorrectionJob]);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({
      ...stagedPreview,
      job_id: reviewableCorrectionJob.id,
      job_kind: "correction",
      correction_frame: 5,
    });
    vi.mocked(videoTrackerApi.cancel).mockResolvedValue({
      ...reviewableCorrectionJob,
      status: "cancelled",
    });
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });
    await store.restoreReviewable("task-1");
    expect(snapshot.candidates["job-correction-1"]).toBeDefined();

    await store.cancel("job-correction-1");

    expect(snapshot.jobs["job-correction-1"]?.status).toBe("cancelled");
    expect(snapshot.candidates["job-correction-1"]).toBeUndefined();
    await store.restoreReviewable("task-2");
  });

  it("取消失败时保留作业与候选", async () => {
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([reviewableCorrectionJob]);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({
      ...stagedPreview,
      job_id: reviewableCorrectionJob.id,
      job_kind: "correction",
      correction_frame: 5,
    });
    vi.mocked(videoTrackerApi.cancel).mockRejectedValue(new Error("offline"));
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });
    await store.restoreReviewable("task-1");

    await store.cancel("job-correction-1");

    expect(snapshot.jobs["job-correction-1"]?.status).toBe("pending_review");
    expect(snapshot.candidates["job-correction-1"]).toBeDefined();
    await store.restoreReviewable("task-2");
  });

  it("取消期间迟到的轮询响应不会复活作业", async () => {
    vi.useFakeTimers();
    try {
      const gate = deferred<VideoTrackerJob>();
      vi.mocked(videoTrackerApi.active).mockResolvedValue([runningCorrectionJob]);
      vi.mocked(videoTrackerApi.get).mockReturnValue(gate.promise);
      vi.mocked(videoTrackerApi.cancel).mockResolvedValue({
        ...runningCorrectionJob,
        status: "cancelled",
      });
      const store = new TrackerJobStore();
      let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
      store.subscribe((next) => {
        snapshot = next;
      });
      await store.restoreReviewable("task-1");
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(videoTrackerApi.get).toHaveBeenCalledWith("job-correction-1");

      await store.cancel("job-correction-1");
      gate.resolve({ ...runningCorrectionJob, status: "running" });
      await Promise.resolve();
      await Promise.resolve();

      expect(snapshot.jobs["job-correction-1"]?.status).toBe("cancelled");
      await store.restoreReviewable("task-2");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TrackerJobStore.restoreReviewable · 切任务 scope 清理 (#9)", () => {
  it("切到新任务时清掉旧任务的候选与 job", async () => {
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([reviewableJob]);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({ ...stagedPreview });
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1");
    expect(snapshot.candidates["job-1"]).toBeDefined();

    // 切到 task-2 (两路皆空) → 旧任务的 job/candidate 应被清掉。
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([]);
    await store.restoreReviewable("task-2");

    expect(snapshot.jobs["job-1"]).toBeUndefined();
    expect(snapshot.candidates["job-1"]).toBeUndefined();
    expect(snapshot.jobs).toEqual({});
    expect(snapshot.candidates).toEqual({});
  });

  it("切任务时关闭旧任务运行中 job 的 WebSocket", async () => {
    vi.mocked(videoTrackerApi.active).mockResolvedValue([runningJob]);
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1", "tok-abc");
    expect(MockWebSocket.instances).toHaveLength(1);
    const staleSocket = MockWebSocket.instances[0];

    vi.mocked(videoTrackerApi.active).mockResolvedValue([]);
    await store.restoreReviewable("task-2", "tok-abc");

    expect(staleSocket.closed).toBe(true);
    expect(snapshot.jobs["job-run-1"]).toBeUndefined();
  });

  it("同一任务重复恢复不会误删本任务的活跃 job", async () => {
    vi.mocked(videoTrackerApi.active).mockResolvedValue([runningJob]);
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1", "tok-abc");
    await store.restoreReviewable("task-1", "tok-abc");

    expect(snapshot.jobs["job-run-1"]?.status).toBe("running");
    // connect 内有 sockets.has 去重, 不应重复建连。
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].closed).toBe(false);
  });

  it("恢复期间切走任务, 迟到的旧任务结果不会被塞回", async () => {
    const gate = deferred<VideoTrackerJob[]>();
    vi.mocked(videoTrackerApi.reviewable).mockReturnValueOnce(gate.promise);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({ ...stagedPreview });
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    // task-1 的恢复卡在 reviewable 上 (不 await)。
    const inflight = store.restoreReviewable("task-1");
    // 用户切到 task-2 (currentTaskId 变更 + scope 清理)。
    await store.restoreReviewable("task-2");
    // 现在放行 task-1 的迟到结果。
    gate.resolve([reviewableJob]);
    await inflight;

    // 护栏应丢弃 task-1 的结果, 不污染 task-2。
    expect(snapshot.jobs["job-1"]).toBeUndefined();
    expect(snapshot.candidates["job-1"]).toBeUndefined();
  });
});

describe("TrackerJobStore.decide · 局部审阅", () => {
  async function restoredStore() {
    vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([reviewableJob]);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({ ...stagedPreview });
    const store = new TrackerJobStore();
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });
    await store.restoreReviewable("task-1");
    return { store, getSnapshot: () => snapshot };
  }

  it("局部成功后用服务端 revision/source version 刷新并保留审阅", async () => {
    const { store, getSnapshot } = await restoredStore();
    const updatedJob = { ...reviewableJob, status: "partially_reviewed" as const, revision: 2 };
    const updatedPreview = {
      ...stagedPreview,
      status: "partially_reviewed" as const,
      job_revision: 2,
      expected_source_versions: { "annotation-1": 2 },
      results: [{ ...stagedPreview.results[0], frame_index: 2 }],
      candidate_accepted: 1,
    };
    vi.mocked(videoTrackerApi.decide).mockResolvedValue(updatedJob);
    vi.mocked(videoTrackerApi.get).mockResolvedValue(updatedJob);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue(updatedPreview);

    const outcome = await store.decide("job-1", {
      instance_ids: ["1"],
      from_frame: 1,
      to_frame: 1,
      decision: "accept",
      override_manual: false,
    });

    expect(outcome).toEqual({ ok: true });
    expect(videoTrackerApi.decide).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        job_revision: 1,
        expected_source_versions: { "annotation-1": 1 },
      }),
    );
    expect(getSnapshot().jobs["job-1"]?.status).toBe("partially_reviewed");
    expect(getSnapshot().candidates["job-1"]?.job_revision).toBe(2);
  });

  it("manual 409 保留候选并把原因交给二次确认", async () => {
    const { store, getSnapshot } = await restoredStore();
    vi.mocked(videoTrackerApi.decide).mockRejectedValue(
      new ApiError(409, "manual", { reason: "manual_keyframe_protected" }),
    );
    const outcome = await store.decide("job-1", {
      instance_ids: ["1"],
      from_frame: 1,
      to_frame: 1,
      decision: "accept",
      override_manual: false,
    });
    expect(outcome).toEqual({ ok: false, reason: "manual_keyframe_protected" });
    expect(getSnapshot().candidates["job-1"]).toBeDefined();
  });

  it("revision 冲突刷新预览且不清候选", async () => {
    const { store, getSnapshot } = await restoredStore();
    const refreshedJob = { ...reviewableJob, status: "partially_reviewed" as const, revision: 3 };
    vi.mocked(videoTrackerApi.decide).mockRejectedValue(
      new ApiError(409, "stale", { reason: "job_revision_conflict" }),
    );
    vi.mocked(videoTrackerApi.get).mockResolvedValue(refreshedJob);
    vi.mocked(videoTrackerApi.preview).mockResolvedValue({ ...stagedPreview, job_revision: 3 });
    const outcome = await store.decide("job-1", {
      instance_ids: ["1"],
      from_frame: 1,
      to_frame: 1,
      decision: "reject",
      override_manual: false,
    });
    expect(outcome.reason).toBe("job_revision_conflict");
    expect(getSnapshot().candidates["job-1"]?.job_revision).toBe(3);
  });
});
