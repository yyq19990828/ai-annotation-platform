import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoFrameSeekResult } from "../stage/videoStageControls";
import { useIssuePins } from "./useIssuePins";

const storeState = {
  highlightId: "",
  highlightFromPin: vi.fn(),
  requestIssuesTab: vi.fn(),
  focusTick: 0,
};
let feedbackItems: Array<Record<string, unknown>> = [];
let issueQueryOverrides: Record<string, unknown> = {};

vi.mock("./useActiveIssueStore", () => ({
  useActiveIssueStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
vi.mock("@/hooks/useFeedbacks", () => ({
  useInfiniteFeedbacks: () => ({
    data: {
      pages: [
        {
          items: feedbackItems,
          next_cursor: null,
          status_counts: {
            open: feedbackItems.filter((item) => item.status === "open").length,
          },
        },
      ],
      pageParams: [null],
    },
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...issueQueryOverrides,
  }),
}));

const stageGeom = { imgW: 1000, imgH: 800, vpSize: { w: 600, h: 400 } };
type Params = Parameters<typeof useIssuePins>[0];

function ready(frameIndex: number): VideoFrameSeekResult {
  return { status: "ready", frameIndex, source: "webcodecs" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(over: Partial<Params> = {}) {
  const setVp = vi.fn();
  const seekVideoFrameReady = vi.fn(async (frame: number, _isRelevant: () => boolean) =>
    ready(frame),
  );
  const pauseVideoPlayback = vi.fn();
  const params: Params = {
    projectId: "P1",
    taskId: "T1",
    stageGeom,
    setVp,
    seekVideoFrameReady,
    pauseVideoPlayback,
    isVideoTask: false,
    ...over,
  };
  return {
    ...renderHook((p: Params) => useIssuePins(p), { initialProps: params }),
    params,
    setVp,
    seekVideoFrameReady,
    pauseVideoPlayback,
  };
}

function startDrop(view: ReturnType<typeof setup>, frame = 3, x = 0.2, y = 0.4) {
  let pending!: Promise<void>;
  act(() => {
    view.result.current.onToggleIssuePinDrop();
    pending = view.result.current.onIssuePinDrop(x, y, frame);
  });
  return pending;
}

describe("useIssuePins", () => {
  beforeEach(() => {
    storeState.highlightId = "";
    storeState.focusTick = 0;
    feedbackItems = [];
    issueQueryOverrides = {};
    vi.clearAllMocks();
  });

  it("counts only open issues", () => {
    feedbackItems = [
      { id: "a", status: "open" },
      { id: "b", status: "resolved" },
      { id: "c", status: "open" },
    ];
    expect(setup().result.current.openIssueCount).toBe(2);
  });

  it("keeps an exact count separate from pin completeness and exposes unknown while absent", () => {
    const pageItems = [
      { id: "a", status: "open", anchor_type: "pixel", anchor_position: { x: 0.1, y: 0.2 } },
    ];
    issueQueryOverrides = {
      data: { pages: [{ items: pageItems, next_cursor: "more" }], pageParams: [null] },
      hasNextPage: true,
    };
    const view = setup();
    expect(view.result.current.openIssueCount).toBeNull();
    expect(view.result.current.issuePinsComplete).toBe(false);
    expect(view.result.current.issuePinsError).toBe(false);
  });

  it("marks a stale cached count unknown when refreshing the first page fails", () => {
    issueQueryOverrides = {
      data: {
        pages: [
          {
            items: [
              {
                id: "cached",
                status: "open",
                anchor_type: "pixel",
                anchor_position: { x: 0.1, y: 0.2 },
              },
            ],
            next_cursor: null,
            status_counts: { open: 9 },
          },
        ],
        pageParams: [null],
      },
      isError: true,
      error: new Error("刷新失败"),
    };
    const view = setup();
    expect(view.result.current.openIssueCount).toBeNull();
    expect(view.result.current.openIssueCountError).toBe(true);
    expect(view.result.current.issuePixelFeedbacks).toHaveLength(1);
  });

  it("retains every loaded current-task pin beyond the first 200-row page", () => {
    const first = Array.from({ length: 200 }, (_, index) => ({
      id: `first-${index}`,
      status: "open",
      anchor_type: "pixel",
      anchor_position: { x: 0.1, y: 0.2 },
    }));
    const second = [
      { id: "second-1", status: "open", anchor_type: "pixel", anchor_position: { x: 0.3, y: 0.4 } },
      {
        id: "second-2",
        status: "resolved",
        anchor_type: "pixel",
        anchor_position: { x: 0.5, y: 0.6 },
      },
    ];
    issueQueryOverrides = {
      data: {
        pages: [
          { items: first, next_cursor: "next", status_counts: { open: 201 } },
          { items: second, next_cursor: null },
        ],
        pageParams: [null, "next"],
      },
    };
    const view = setup();
    expect(view.result.current.issuePixelFeedbacks).toHaveLength(202);
    expect(view.result.current.issuePixelFeedbacks.map((item) => item.id)).toContain("second-2");
    expect(view.result.current.issuePinsComplete).toBe(true);
    expect(view.result.current.openIssueCount).toBe(201);
  });

  it("continues automatic pin paging through a third page after each cursor resolves", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const fetchNextPage = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    issueQueryOverrides = {
      data: {
        pages: [
          {
            items: [
              {
                id: "p1",
                status: "open",
                anchor_type: "pixel",
                anchor_position: { x: 0.1, y: 0.1 },
              },
            ],
            next_cursor: "cursor-2",
            status_counts: { open: 3 },
          },
        ],
        pageParams: [null],
      },
      hasNextPage: true,
      fetchNextPage,
    };
    const view = setup();
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));

    first.resolve({});
    await act(async () => {
      await first.promise;
    });
    issueQueryOverrides = {
      data: {
        pages: [
          {
            items: [
              {
                id: "p1",
                status: "open",
                anchor_type: "pixel",
                anchor_position: { x: 0.1, y: 0.1 },
              },
            ],
            next_cursor: "cursor-2",
            status_counts: { open: 3 },
          },
          {
            items: [
              {
                id: "p2",
                status: "resolved",
                anchor_type: "pixel",
                anchor_position: { x: 0.2, y: 0.2 },
              },
            ],
            next_cursor: "cursor-3",
          },
        ],
        pageParams: [null, "cursor-2"],
      },
      hasNextPage: true,
      fetchNextPage,
    };
    view.rerender(view.params);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(2));

    second.resolve({});
    await act(async () => {
      await second.promise;
    });
    issueQueryOverrides = {
      data: {
        pages: [
          {
            items: [
              {
                id: "p1",
                status: "open",
                anchor_type: "pixel",
                anchor_position: { x: 0.1, y: 0.1 },
              },
            ],
            next_cursor: "cursor-2",
            status_counts: { open: 3 },
          },
          {
            items: [
              {
                id: "p2",
                status: "resolved",
                anchor_type: "pixel",
                anchor_position: { x: 0.2, y: 0.2 },
              },
            ],
            next_cursor: "cursor-3",
          },
          {
            items: [
              {
                id: "p3",
                status: "open",
                anchor_type: "pixel",
                anchor_position: { x: 0.3, y: 0.3 },
              },
            ],
            next_cursor: null,
          },
        ],
        pageParams: [null, "cursor-2", "cursor-3"],
      },
      hasNextPage: false,
    };
    view.rerender(view.params);
    expect(view.result.current.issuePixelFeedbacks.map((item) => item.id)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(view.result.current.issuePinsComplete).toBe(true);
  });

  it("does not let a late page request from task A clear task B's pins", async () => {
    const pending = deferred<unknown>();
    const fetchNextPage = vi.fn(() => pending.promise);
    issueQueryOverrides = {
      data: {
        pages: [{ items: [{ id: "a", status: "open" }], next_cursor: "more" }],
        pageParams: [null],
      },
      hasNextPage: true,
      fetchNextPage,
    };
    const view = setup();
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));
    issueQueryOverrides = {
      data: {
        pages: [
          {
            items: [
              {
                id: "b",
                status: "open",
                anchor_type: "pixel",
                anchor_position: { x: 0.7, y: 0.8 },
              },
            ],
            next_cursor: null,
            status_counts: { open: 1 },
          },
        ],
        pageParams: [null],
      },
      hasNextPage: false,
    };
    view.rerender({ ...view.params, taskId: "T2" });
    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
    expect(view.result.current.issuePixelFeedbacks.map((item) => item.id)).toEqual(["b"]);
  });

  it("opens a task-level video Issue without any frame readiness dependency", () => {
    const view = setup({ isVideoTask: true });
    act(() => view.result.current.openTaskIssue());
    expect(view.result.current.issueCreateOpen).toBe(true);
    expect(view.result.current.issuePinPrefill).toBeNull();
    expect(view.result.current.issueNavigation.status).toBe("idle");
    expect(view.seekVideoFrameReady).not.toHaveBeenCalled();
  });

  it("opening a task Issue retires the unfinished pixel request without inheriting its anchor", async () => {
    const pending = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockReturnValueOnce(pending.promise);
    const navigation = startDrop(view, 3);
    act(() => view.result.current.openTaskIssue());
    expect(view.result.current.issuePinDropArmed).toBe(false);
    expect(view.result.current.issuePinPrefill).toBeNull();
    await act(async () => {
      pending.resolve(ready(3));
      await navigation;
    });
    expect(view.result.current.issueCreateOpen).toBe(true);
    expect(view.result.current.issuePinPrefill).toBeNull();
    expect(view.result.current.issueNavigation.status).toBe("idle");
    expect(view.seekVideoFrameReady).toHaveBeenCalledTimes(1);
  });

  it("centers an image pixel anchor only after a list focus request", () => {
    feedbackItems = [
      {
        id: "issue",
        project_id: "P1",
        task_id: "T1",
        anchor_type: "pixel",
        anchor_position: { x: 0.5, y: 0.5 },
      },
    ];
    storeState.highlightId = "issue";
    const view = setup();
    expect(view.setVp).not.toHaveBeenCalled();
    storeState.focusTick++;
    view.rerender(view.params);
    expect(view.setVp).toHaveBeenCalledTimes(1);
    expect(view.seekVideoFrameReady).not.toHaveBeenCalled();
  });

  it("selects an available associated image object before centering", async () => {
    const target = {
      id: "issue",
      project_id: "P1",
      task_id: "T1",
      annotation_id: "annotation-1",
      anchor_type: "pixel",
      anchor_position: { x: 0.5, y: 0.5 },
    };
    feedbackItems = [target];
    storeState.highlightId = target.id;
    const selectImageAnnotation = vi.fn(async (id: string, isCurrent: () => boolean) => {
      expect(id).toBe("annotation-1");
      expect(isCurrent()).toBe(true);
      return true;
    });
    const view = setup({ selectImageAnnotation });
    storeState.focusTick++;
    view.rerender(view.params);
    await waitFor(() => expect(selectImageAnnotation).toHaveBeenCalledOnce());
    expect(view.setVp).toHaveBeenCalledOnce();
  });

  it("does not center when image selection reports a cancelled request", async () => {
    const target = {
      id: "issue",
      project_id: "P1",
      task_id: "T1",
      annotation_id: "annotation-1",
      anchor_type: "pixel",
      anchor_position: { x: 0.5, y: 0.5 },
    };
    feedbackItems = [target];
    storeState.highlightId = target.id;
    const selectImageAnnotation = vi.fn(async () => false);
    const view = setup({ selectImageAnnotation });
    storeState.focusTick++;
    view.rerender(view.params);
    await waitFor(() => expect(selectImageAnnotation).toHaveBeenCalledOnce());
    expect(view.setVp).not.toHaveBeenCalled();
  });

  it("does not restore an image viewport after the owner changes during selection", async () => {
    const target = {
      id: "issue",
      project_id: "P1",
      task_id: "T1",
      annotation_id: "annotation-1",
      anchor_type: "pixel",
      anchor_position: { x: 0.5, y: 0.5 },
    };
    feedbackItems = [target];
    storeState.highlightId = target.id;
    const selection = deferred<boolean>();
    const selectImageAnnotation = vi.fn(() => selection.promise);
    const view = setup({ selectImageAnnotation });
    storeState.focusTick++;
    view.rerender(view.params);
    await waitFor(() => expect(selectImageAnnotation).toHaveBeenCalledOnce());
    view.rerender({ ...view.params, taskId: "T2" });
    await act(async () => {
      selection.resolve(true);
      await selection.promise;
    });
    expect(view.setVp).not.toHaveBeenCalled();
  });

  it.each([
    { anchor_type: "point_cloud", anchor_position: { frame: 0 } },
    { anchor_position: null },
  ])("does not center an image issue without pixel coordinates: %j", (anchor) => {
    feedbackItems = [{ id: "issue", project_id: "P1", task_id: "T1", ...anchor }];
    storeState.highlightId = "issue";
    const view = setup();
    storeState.focusTick++;
    view.rerender(view.params);
    expect(view.setVp).not.toHaveBeenCalled();
  });

  it("pauses video immediately when armed and waits for a drop before seeking", () => {
    const view = setup({ isVideoTask: true });
    act(() => view.result.current.onToggleIssuePinDrop());
    expect(view.pauseVideoPlayback).toHaveBeenCalledTimes(1);
    expect(view.seekVideoFrameReady).not.toHaveBeenCalled();
    expect(view.result.current.issuePinDropArmed).toBe(true);
    act(() => view.result.current.onToggleIssuePinDrop());
    expect(view.pauseVideoPlayback).toHaveBeenCalledTimes(1);
    expect(view.result.current.issuePinDropArmed).toBe(false);
  });

  it("keeps image drops synchronous and excludes a supplied video frame", async () => {
    const view = setup();
    await act(async () => {
      view.result.current.onToggleIssuePinDrop();
      await view.result.current.onIssuePinDrop(0.25, 0.75, 17);
    });
    expect(view.result.current.issueCreateOpen).toBe(true);
    expect(view.result.current.issuePinPrefill).toEqual({ x: 0.25, y: 0.75 });
    expect(view.pauseVideoPlayback).not.toHaveBeenCalled();
    expect(view.seekVideoFrameReady).not.toHaveBeenCalled();
  });

  it("captures the current saved image object together with the pixel", async () => {
    const captureImageContext = vi.fn(() => ({
      annotationId: "annotation-123456",
      annotationLabel: "车辆",
    }));
    const view = setup({ captureImageContext });
    await act(async () => {
      view.result.current.onToggleIssuePinDrop();
      await view.result.current.onIssuePinDrop(0.25, 0.75);
    });
    expect(captureImageContext).toHaveBeenCalledOnce();
    expect(view.result.current.issuePinPrefill).toEqual({
      x: 0.25,
      y: 0.75,
      annotationId: "annotation-123456",
      annotationLabel: "车辆",
    });
  });

  it("opens video F0 only after exact readiness and consumes the drop once", async () => {
    const frameReady = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockReturnValue(frameReady.promise);
    const pending = startDrop(view, 0);
    expect(view.result.current.issueCreateOpen).toBe(false);
    expect(view.result.current.issuePinDropArmed).toBe(false);
    expect(view.result.current.issueNavigation).toEqual({ status: "preparing", frameIndex: 0 });
    expect(view.result.current.issuePinPrefill).toEqual({ x: 0.2, y: 0.4, frame: 0 });
    await act(async () => view.result.current.onIssuePinDrop(0.8, 0.8, 17));
    expect(view.seekVideoFrameReady).toHaveBeenCalledTimes(1);
    await act(async () => {
      frameReady.resolve(ready(0));
      await pending;
    });
    expect(view.result.current.issueCreateOpen).toBe(true);
    expect(view.result.current.issueNavigation).toEqual({ status: "ready", frameIndex: 0 });
    expect(view.result.current.issuePinPrefill).toEqual({ x: 0.2, y: 0.4, frame: 0 });
  });

  it.each(["cancelled", "timeout", "unavailable"] as const)(
    "retains a failed %s drop and retries the same point and source frame",
    async (status) => {
      const view = setup({ isVideoTask: true });
      view.seekVideoFrameReady.mockResolvedValueOnce({ status, frameIndex: 3, source: null });
      await act(async () => {
        view.result.current.onToggleIssuePinDrop();
        await view.result.current.onIssuePinDrop(0.2, 0.4, 3);
      });
      expect(view.result.current.issueCreateOpen).toBe(false);
      expect(view.result.current.issueNavigation).toEqual({ status, frameIndex: 3 });
      expect(view.result.current.issuePinPrefill).toEqual({ x: 0.2, y: 0.4, frame: 3 });
      await act(async () => view.result.current.retryIssueNavigation());
      expect(view.seekVideoFrameReady).toHaveBeenLastCalledWith(3, expect.any(Function));
      expect(view.result.current.issueCreateOpen).toBe(true);
      expect(view.result.current.issuePinPrefill).toEqual({ x: 0.2, y: 0.4, frame: 3 });
    },
  );

  it("does not treat a neighboring painted frame as the requested frame", async () => {
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockResolvedValueOnce(ready(4));
    await act(async () => {
      view.result.current.onToggleIssuePinDrop();
      await view.result.current.onIssuePinDrop(0.2, 0.4, 3);
    });
    expect(view.result.current.issueCreateOpen).toBe(false);
    expect(view.result.current.issueNavigation).toEqual({ status: "unavailable", frameIndex: 3 });
  });

  it("turns a seek exception into a retryable unavailable result", async () => {
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockRejectedValueOnce(new Error("decoder closed"));
    await act(async () => view.result.current.onSeekIssueFrame(17));
    expect(view.result.current.issueNavigation).toEqual({ status: "unavailable", frameIndex: 17 });
    await act(async () => view.result.current.retryIssueNavigation());
    expect(view.result.current.issueNavigation).toEqual({ status: "ready", frameIndex: 17 });
    expect(view.result.current.issueCreateOpen).toBe(false);
  });

  it.each([undefined, NaN, Infinity, -1, 0.5])(
    "refuses invalid video source frame %s",
    async (frame) => {
      const view = setup({ isVideoTask: true });
      await act(async () => {
        view.result.current.onToggleIssuePinDrop();
        await view.result.current.onIssuePinDrop(0.2, 0.4, frame);
      });
      expect(view.seekVideoFrameReady).not.toHaveBeenCalled();
      expect(view.result.current.issueCreateOpen).toBe(false);
      expect(view.result.current.issueNavigation.status).toBe("unavailable");
    },
  );

  it("ignores unarmed drops and invalid coordinates without opening a form", async () => {
    const view = setup({ isVideoTask: true });
    await act(async () => view.result.current.onIssuePinDrop(0.2, 0.4, 3));
    act(() => view.result.current.onToggleIssuePinDrop());
    await act(async () => {
      await view.result.current.onIssuePinDrop(NaN, 0.4, 3);
      await view.result.current.onIssuePinDrop(0.2, 1.1, 3);
    });
    expect(view.seekVideoFrameReady).not.toHaveBeenCalled();
    expect(view.result.current.issueCreateOpen).toBe(false);
    expect(view.result.current.issuePinDropArmed).toBe(true);
  });

  it("list focus and retry retain the original durable frame after query changes", async () => {
    feedbackItems = [
      {
        id: "issue",
        project_id: "P1",
        task_id: "T1",
        anchor_type: "pixel",
        anchor_position: { x: 0.2, y: 0.4, frame: 3 },
      },
    ];
    storeState.highlightId = "issue";
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockResolvedValueOnce({
      status: "timeout",
      frameIndex: 3,
      source: null,
    });
    storeState.focusTick++;
    await act(async () => view.rerender(view.params));
    expect(view.result.current.issueNavigation).toEqual({ status: "timeout", frameIndex: 3 });
    feedbackItems = [
      {
        id: "issue",
        project_id: "P1",
        task_id: "T1",
        anchor_type: "pixel",
        anchor_position: { x: 0.2, y: 0.4, frame: 17 },
      },
    ];
    view.rerender(view.params);
    expect(view.seekVideoFrameReady).toHaveBeenCalledTimes(1);
    await act(async () => view.result.current.retryIssueNavigation());
    expect(view.seekVideoFrameReady).toHaveBeenLastCalledWith(3, expect.any(Function));
    expect(view.result.current.issueNavigation).toEqual({ status: "ready", frameIndex: 3 });
    expect(view.result.current.issueCreateOpen).toBe(false);
    expect(feedbackItems[0].anchor_position).toEqual({ x: 0.2, y: 0.4, frame: 17 });
  });

  it("lets a newer timeline request supersede an unfinished drop", async () => {
    const first = deferred<VideoFrameSeekResult>();
    const second = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldDrop = startDrop(view, 3);
    const oldRelevant = view.seekVideoFrameReady.mock.calls[0][1];
    let newSeek!: Promise<void>;
    act(() => {
      newSeek = view.result.current.onSeekIssueFrame(17);
    });
    expect(oldRelevant()).toBe(false);
    await act(async () => {
      second.resolve(ready(17));
      await newSeek;
    });
    await act(async () => {
      first.resolve(ready(3));
      await oldDrop;
    });
    expect(view.result.current.issueNavigation).toEqual({ status: "ready", frameIndex: 17 });
    expect(view.result.current.issueCreateOpen).toBe(false);
  });

  it("cancels old readiness on close and cannot reopen over a newer drop", async () => {
    const oldFrame = deferred<VideoFrameSeekResult>();
    const newFrame = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady
      .mockReturnValueOnce(oldFrame.promise)
      .mockReturnValueOnce(newFrame.promise);
    const oldDrop = startDrop(view, 3);
    const oldRelevant = view.seekVideoFrameReady.mock.calls[0][1];
    act(() => view.result.current.closeIssueCreate());
    const newDrop = startDrop(view, 17, 0.7, 0.8);
    expect(oldRelevant()).toBe(false);
    await act(async () => {
      oldFrame.resolve(ready(3));
      await oldDrop;
    });
    expect(view.result.current.issueCreateOpen).toBe(false);
    expect(view.result.current.issueNavigation).toEqual({ status: "preparing", frameIndex: 17 });
    await act(async () => {
      newFrame.resolve(ready(17));
      await newDrop;
    });
    expect(view.result.current.issuePinPrefill).toEqual({ x: 0.7, y: 0.8, frame: 17 });
    expect(view.result.current.issueCreateOpen).toBe(true);
  });

  it.each([{ taskId: "T2" }, { projectId: "P2" }, { isVideoTask: false }])(
    "invalidates pending readiness across owner A → B → A: %j",
    async (change) => {
      const frameReady = deferred<VideoFrameSeekResult>();
      const view = setup({ isVideoTask: true });
      view.seekVideoFrameReady.mockReturnValueOnce(frameReady.promise);
      const pending = startDrop(view);
      const oldRelevant = view.seekVideoFrameReady.mock.calls[0][1];
      view.rerender({ ...view.params, ...change });
      expect(view.result.current.issuePinPrefill).toBeNull();
      expect(view.result.current.issueNavigation.status).toBe("idle");
      view.rerender(view.params);
      expect(oldRelevant()).toBe(false);
      await act(async () => {
        frameReady.resolve(ready(3));
        await pending;
      });
      expect(view.result.current.issueCreateOpen).toBe(false);
      expect(view.result.current.issueNavigation.status).toBe("idle");
    },
  );

  it("does not let a retired task callback cancel the new task request", async () => {
    const frameReady = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    const oldClose = view.result.current.closeIssueCreate;
    view.rerender({ ...view.params, taskId: "T2" });
    view.seekVideoFrameReady.mockReturnValueOnce(frameReady.promise);
    const pending = startDrop(view, 17);
    const relevant = view.seekVideoFrameReady.mock.calls[0][1];
    act(oldClose);
    expect(relevant()).toBe(true);
    await act(async () => {
      frameReady.resolve(ready(17));
      await pending;
    });
    expect(view.result.current.issueCreateOpen).toBe(true);
  });

  it("does not start duplicate retries while a retry is preparing", async () => {
    const frameReady = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockResolvedValueOnce({
      status: "timeout",
      frameIndex: 3,
      source: null,
    });
    await act(async () => view.result.current.onSeekIssueFrame(3));
    view.seekVideoFrameReady.mockReturnValueOnce(frameReady.promise);
    let retry!: Promise<void>;
    act(() => {
      retry = view.result.current.retryIssueNavigation();
    });
    await act(async () => view.result.current.retryIssueNavigation());
    expect(view.seekVideoFrameReady).toHaveBeenCalledTimes(2);
    await act(async () => {
      frameReady.resolve(ready(3));
      await retry;
    });
  });

  it("invalidates the relevance receipt on unmount", async () => {
    const frameReady = deferred<VideoFrameSeekResult>();
    const view = setup({ isVideoTask: true });
    view.seekVideoFrameReady.mockReturnValueOnce(frameReady.promise);
    const pending = startDrop(view);
    const relevant = view.seekVideoFrameReady.mock.calls[0][1];
    view.unmount();
    expect(relevant()).toBe(false);
    await act(async () => {
      frameReady.resolve(ready(3));
      await pending;
    });
  });
});
