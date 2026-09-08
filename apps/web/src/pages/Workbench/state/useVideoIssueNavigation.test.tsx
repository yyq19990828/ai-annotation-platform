import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { AnnotationFeedback } from "@/api/feedbacks";
import type { AnnotationResponse } from "@/types";
import type { VideoStageControls } from "../stage/videoStageControls";
import { useVideoIssueNavigation } from "./useVideoIssueNavigation";

const getTask = vi.hoisted(() => vi.fn());
vi.mock("@/api/tasks", () => ({ tasksApi: { get: getTask } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function issue(over: Partial<AnnotationFeedback> = {}): AnnotationFeedback {
  return {
    id: "I1",
    project_id: "P1",
    task_id: "T1",
    annotation_id: "A1",
    anchor_type: "pixel",
    anchor_position: {
      x: 0.35,
      y: 0.4,
      frame: 130,
      video_context: {
        schema_version: 1,
        annotation_version: 3,
        track_id: "trk_first",
        viewport: { center_x: 0.6, center_y: 0.7, zoom: 2 },
        timeline_window: { from: 100.5, to: 160.5 },
        frame_range: { from_frame: 120, to_frame: 160 },
      },
    },
    ...over,
  } as AnnotationFeedback;
}

function setup() {
  const events: string[] = [];
  let interrupt: (() => void) | undefined;
  const unsubscribe = vi.fn(() => {
    interrupt = undefined;
  });
  const release = vi.fn(() => {
    events.push("release");
  });
  const restore = vi.fn(async () => {
    events.push("restore");
    return { status: "restored" as const, clamped: false };
  });
  const controls = {
    captureIssueView: vi.fn(() => ({
      taskId: "T1",
      frameIndex: 10,
      viewport: { center_x: 0.5, center_y: 0.5, zoom: 1.2 },
      timeline_window: { from: 0, to: 179 },
    })),
    waitForIssueViewReady: vi.fn(async () => {
      events.push("view-ready");
      return true;
    }),
    beginIssueRestore: vi.fn(() => {
      events.push("lease");
      return { restore, release };
    }),
    subscribeIssueNavigationInterrupt: vi.fn((listener: () => void) => {
      interrupt = listener;
      return unsubscribe;
    }),
  };
  const props = {
    projectId: "P1",
    taskId: "T1" as string | undefined,
    requestedTaskId: "T1" as string | null,
    annotationsReady: true,
    annotations: [{ id: "A1", task_id: "T1", is_active: true, version: 3 }] as AnnotationResponse[],
    frameCount: 180,
    controlsRef: { current: controls as unknown as VideoStageControls },
    selectTask: vi.fn(async () => true),
    seekFrame: vi.fn(async (frameIndex: number) => {
      events.push("frame-ready");
      return { status: "ready" as const, frameIndex, source: "webcodecs" as const };
    }),
    selectObject: vi.fn(() => {
      events.push("selection");
    }),
  };
  getTask.mockImplementation(async (id: string) => {
    events.push("permission");
    return { id, project_id: "P1", file_type: "video" };
  });
  const view = renderHook((input) => useVideoIssueNavigation(input), { initialProps: props });
  return {
    ...view,
    props,
    controls,
    restore,
    release,
    events,
    unsubscribe,
    interrupt: () => interrupt?.(),
  };
}

describe("video Issue navigation ownership", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("confirms permissions and exact pixels before applying selection and the saved view once", async () => {
    const view = setup();
    await act(() => view.result.current.navigate(issue()));
    expect(view.events).toEqual([
      "permission",
      "view-ready",
      "frame-ready",
      "lease",
      "selection",
      "restore",
      "release",
    ]);
    expect(view.props.selectObject).toHaveBeenCalledWith("A1");
    expect(view.restore).toHaveBeenCalledWith(
      {
        viewport: { center_x: 0.6, center_y: 0.7, zoom: 2 },
        timeline_window: { from: 100.5, to: 160.5 },
      },
      "A1",
    );
    expect(view.result.current.navigation).toMatchObject({ status: "ready", frameIndex: 130 });
    expect(view.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps the original task, frame and selection when target permission is revoked", async () => {
    const view = setup();
    getTask.mockRejectedValue(new ApiError(404, "Task not found"));
    await act(() => view.result.current.navigate(issue({ task_id: "T2" })));
    expect(view.props.selectTask).not.toHaveBeenCalled();
    expect(view.props.seekFrame).not.toHaveBeenCalled();
    expect(view.props.selectObject).not.toHaveBeenCalled();
    expect(view.result.current.navigation.message).toBe("无法访问问题所在任务");
  });

  it("honors a cancelled cross-task draft guard", async () => {
    const view = setup();
    view.props.selectTask.mockResolvedValue(false);
    await act(() => view.result.current.navigate(issue({ task_id: "T2" })));
    expect(view.result.current.navigation.status).toBe("cancelled");
    expect(view.props.seekFrame).not.toHaveBeenCalled();
    expect(view.props.selectObject).not.toHaveBeenCalled();
  });

  it("waits through an unresolved task and annotation query before using the target Stage", async () => {
    const view = setup();
    let work!: Promise<void>;
    await act(async () => {
      work = view.result.current.navigate(issue({ task_id: "T2" }));
    });
    view.rerender({
      ...view.props,
      taskId: undefined,
      requestedTaskId: "T2",
      annotationsReady: false,
    });
    expect(view.props.seekFrame).not.toHaveBeenCalled();
    view.controls.captureIssueView.mockReturnValue({
      ...view.controls.captureIssueView(),
      taskId: "T2",
    });
    await act(async () => {
      view.rerender({ ...view.props, taskId: "T2", requestedTaskId: "T2" });
    });
    await act(() => work);
    expect(view.result.current.navigation.status).toBe("ready");
    expect(view.props.selectTask).toHaveBeenCalledWith("T2", expect.any(AbortSignal));
  });

  it.each(["changed", "deleted", "foreign-key-cleared"])(
    "restores the pixel anchor for an object that is %s",
    async (mode) => {
      const view = setup();
      view.rerender({
        ...view.props,
        annotations: mode === "changed" ? [{ ...view.props.annotations[0], version: 4 }] : [],
      });
      await act(() =>
        view.result.current.navigate(
          issue(mode === "foreign-key-cleared" ? { annotation_id: null } : {}),
        ),
      );
      expect(view.props.selectObject).toHaveBeenCalledWith(null);
      expect(view.restore).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport: { center_x: 0.35, center_y: 0.4, zoom: 1.2 },
        }),
        null,
      );
      expect(view.result.current.navigation.message).toContain("对象已变化");
    },
  );

  it.each([undefined, { schema_version: 999, viewport: { zoom: 100 } }])(
    "uses the legacy frame and pixel anchor for unsupported context %j",
    async (context) => {
      const view = setup();
      await act(() =>
        view.result.current.navigate(
          issue({
            anchor_position: {
              x: 0.2,
              y: 0.3,
              frame: 0,
              video_context: context,
            },
          }),
        ),
      );
      expect(view.props.seekFrame).toHaveBeenCalledWith(0, expect.any(Function));
      expect(view.restore).not.toHaveBeenCalled();
      expect(view.props.selectObject).not.toHaveBeenCalled();
      expect(view.result.current.navigation.status).toBe("ready");
    },
  );

  it.each([true, false])("reports shortened media with context present=%s", async (withContext) => {
    const view = setup();
    view.rerender({ ...view.props, frameCount: 100 });
    const target = issue();
    if (!withContext) delete target.anchor_position!.video_context;
    await act(() => view.result.current.navigate(target));
    expect(view.props.seekFrame).toHaveBeenCalledWith(99, expect.any(Function));
    expect(view.result.current.navigation).toMatchObject({ status: "ready", frameIndex: 99 });
    expect(view.result.current.navigation.message).toContain("边界已变化");
  });

  it("lets only the newest Issue apply when permission requests finish out of order", async () => {
    const view = setup();
    const first = deferred<{ id: string; project_id: string; file_type: string }>();
    getTask.mockImplementationOnce(() => first.promise);
    let oldWork!: Promise<void>;
    await act(async () => {
      oldWork = view.result.current.navigate(issue());
    });
    await act(() =>
      view.result.current.navigate(
        issue({ id: "I2", anchor_position: { x: 0.5, y: 0.5, frame: 17 } }),
      ),
    );
    await act(async () => {
      first.resolve({ id: "T1", project_id: "P1", file_type: "video" });
      await oldWork;
    });
    expect(view.props.seekFrame).toHaveBeenCalledTimes(1);
    expect(view.props.seekFrame).toHaveBeenCalledWith(17, expect.any(Function));
    expect(view.result.current.navigation.frameIndex).toBe(17);
  });

  it("cancels an earlier navigation when the user manipulates the Stage during frame preparation", async () => {
    const view = setup();
    const ready = deferred<{ status: "ready"; frameIndex: number; source: "webcodecs" }>();
    view.props.seekFrame.mockImplementationOnce(() => ready.promise);
    let work!: Promise<void>;
    await act(async () => {
      work = view.result.current.navigate(issue());
    });
    act(() => view.interrupt());
    await act(async () => {
      ready.resolve({ status: "ready", frameIndex: 130, source: "webcodecs" });
      await work;
    });
    expect(view.props.selectObject).not.toHaveBeenCalled();
    expect(view.restore).not.toHaveBeenCalled();
    expect(view.result.current.navigation.status).toBe("idle");
  });

  it("retains the same Issue for retry and releases a failed restore lease", async () => {
    const view = setup();
    view.restore.mockRejectedValueOnce(new Error("draw failed"));
    await act(() => view.result.current.navigate(issue()));
    expect(view.release).toHaveBeenCalledTimes(1);
    expect(view.result.current.navigation.status).toBe("unavailable");
    await act(() => view.result.current.retry());
    expect(view.release).toHaveBeenCalledTimes(2);
    expect(view.result.current.navigation.status).toBe("ready");
  });

  it("does not revive a pending request after project identity cycles A → B → A", async () => {
    const view = setup();
    const permission = deferred<{ id: string; project_id: string; file_type: string }>();
    getTask.mockImplementationOnce(() => permission.promise);
    let work!: Promise<void>;
    await act(async () => {
      work = view.result.current.navigate(issue());
    });
    view.rerender({ ...view.props, projectId: "P2" });
    view.rerender(view.props);
    await act(async () => {
      permission.resolve({ id: "T1", project_id: "P1", file_type: "video" });
      await work;
    });
    expect(view.props.seekFrame).not.toHaveBeenCalled();
    expect(view.result.current.navigation.status).toBe("idle");
  });
});
