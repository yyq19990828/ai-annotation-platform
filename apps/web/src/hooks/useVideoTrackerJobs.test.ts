import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { videoTrackerApi, type VideoTrackerJob } from "@/api/videoTracker";
import { TrackerJobStore, type TrackerStoreState } from "./useVideoTrackerJobs";

vi.mock("@/api/videoTracker", () => ({
  videoTrackerApi: {
    reviewable: vi.fn(),
    active: vi.fn(),
    preview: vi.fn(),
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

const stagedPreview = {
  job_id: reviewableJob.id,
  status: reviewableJob.status,
  annotation_id: reviewableJob.annotation_id,
  results: [
    { frame_index: 1, geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
  ],
  grid_step: 1,
  output_geometry: "bbox",
};

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  // 两路拉取默认空,单测按需覆盖其一。
  vi.mocked(videoTrackerApi.reviewable).mockResolvedValue([]);
  vi.mocked(videoTrackerApi.active).mockResolvedValue([]);
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
    let snapshot: TrackerStoreState = { jobs: {}, candidates: {}, submitting: {} };
    store.subscribe((next) => {
      snapshot = next;
    });

    await store.restoreReviewable("task-1");

    expect(snapshot.jobs).toEqual({});
    expect(snapshot.candidates).toEqual({});
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
