import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VideoStage, type VideoStageControls } from "./VideoStage";
import { VideoTrackSidebar } from "./VideoTrackSidebar";
import { videoNavigationStorageKey } from "./videoNavigationState";
import type { AnnotationResponse, TaskVideoManifestResponse } from "@/types";

const apiMocks = vi.hoisted(() => ({
  getVideoFrame: vi.fn(),
  prefetchVideoFrames: vi.fn(),
}));

vi.mock("@/api/tasks", () => ({
  tasksApi: apiMocks,
}));

const manifest: TaskVideoManifestResponse = {
  task_id: "task-1",
  video_url: "http://storage.local/video.mp4",
  poster_url: "http://storage.local/poster.webp",
  expires_in: 3600,
  metadata: {
    duration_ms: 1000,
    fps: 10,
    frame_count: 10,
    width: 1000,
    height: 500,
    codec: "h264",
    playback_path: null,
    playback_codec: null,
    playback_error: null,
    poster_frame_path: "poster.webp",
    probe_error: null,
    poster_error: null,
    frame_timetable_frame_count: null,
    frame_timetable_error: null,
  },
};

const playMock = vi.fn();
const pauseMock = vi.fn();
const closeBitmapMock = vi.fn();

function setRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 500,
    right: 1000,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function pointer(type: string, clientX: number, clientY: number, button = 0) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button,
  });
}

function installBitmapMocks() {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const createImageBitmapMock = vi.fn().mockResolvedValue({
    width: 1000,
    height: 500,
    close: closeBitmapMock,
  });
  Object.defineProperty(window, "createImageBitmap", {
    value: createImageBitmapMock,
    writable: true,
    configurable: true,
  });
  return { createImageBitmapMock, drawImage };
}

describe("VideoStage", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pauseMock });
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playMock });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 500 });
  });

  beforeEach(() => {
    playMock.mockClear();
    pauseMock.mockClear();
    apiMocks.getVideoFrame.mockReset();
    apiMocks.prefetchVideoFrames.mockReset();
    apiMocks.getVideoFrame.mockResolvedValue({
      frame_index: 0,
      width: 320,
      format: "webp",
      status: "ready",
      url: "/frame-0.webp",
      retry_after: null,
      error: null,
    });
    apiMocks.prefetchVideoFrames.mockResolvedValue({
      dataset_item_id: "item-1",
      task_id: "task-1",
      frames: [],
    });
    closeBitmapMock.mockClear();
    Object.defineProperty(window, "createImageBitmap", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    sessionStorage.clear();
  });

  it("draws a bbox on the current frame while paused", () => {
    const onCreate = vi.fn();
    const { getByTestId, getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={onCreate}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent(overlay, pointer("pointerdown", 100, 100));
    fireEvent(overlay, pointer("pointermove", 400, 250));
    fireEvent(overlay, pointer("pointerup", 400, 250));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [frame, geom] = onCreate.mock.calls[0];
    expect(frame).toBe(0);
    expect(geom.x).toBeCloseTo(0.1);
    expect(geom.y).toBeCloseTo(0.2);
    expect(geom.w).toBeCloseTo(0.3);
    expect(geom.h).toBeCloseTo(0.3);
  });

  it("does not toggle playback when clicking the paused overlay without drawing", () => {
    const onCreate = vi.fn();
    const { getByTestId, getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={onCreate}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent(overlay, pointer("pointerdown", 100, 100));
    fireEvent(overlay, pointer("pointerup", 100, 100));

    expect(playMock).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows playback errors when the browser rejects the video source", async () => {
    playMock.mockRejectedValueOnce(new Error("The element has no supported sources."));
    const { getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    fireEvent.click(getByTitle("播放 / 暂停 (Space)"));

    expect(await screen.findByTestId("video-playback-error")).toHaveTextContent("no supported sources");
  });

  it("exposes playback and frame seeking through ref controls", async () => {
    const ref = createRef<VideoStageControls>();
    const { getByLabelText } = render(
      <VideoStage
        ref={ref}
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await act(async () => {
      ref.current?.togglePlayback();
    });
    expect(playMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      ref.current?.seekByFrames(3);
    });
    expect(pauseMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("3"));
  });

  it("supports J/K/L style jog playback through ref controls", async () => {
    const ref = createRef<VideoStageControls>();
    const { container, getByTestId, queryByTestId } = render(
      <VideoStage
        ref={ref}
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const video = container.querySelector("video")!;

    await act(async () => {
      ref.current?.jogPlayback(1);
    });
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    expect(video.playbackRate).toBe(1);
    expect(getByTestId("video-playback-rate")).toHaveTextContent("1x");

    await act(async () => {
      ref.current?.jogPlayback(1);
    });
    await waitFor(() => expect(video.playbackRate).toBe(2));
    expect(getByTestId("video-playback-rate")).toHaveTextContent("2x");

    await act(async () => {
      ref.current?.pausePlayback();
    });
    expect(pauseMock).toHaveBeenCalled();
    expect(video.playbackRate).toBe(1);
    expect(queryByTestId("video-playback-rate")).not.toBeInTheDocument();
  });

  it("starts reverse jog playback without using negative native playbackRate", async () => {
    const ref = createRef<VideoStageControls>();
    const { container, getByTestId } = render(
      <VideoStage
        ref={ref}
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        frameIndex={5}
        onFrameIndexChange={() => {}}
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const video = container.querySelector("video")!;

    await act(async () => {
      ref.current?.jogPlayback(-1);
    });

    expect(pauseMock).toHaveBeenCalled();
    expect(video.playbackRate).toBe(1);
    expect(getByTestId("video-playback-rate")).toHaveTextContent("-1x");
  });

  it("seeks to the next visible keyframe through ref controls", async () => {
    const ref = createRef<VideoStageControls>();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          outside: [{ from: 3, to: 4 }],
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 3, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 5, bbox: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }, source: "manual", absent: true },
            { frame_index: 7, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "prediction" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText } = render(
      <VideoStage
        ref={ref}
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await act(async () => {
      ref.current?.seekToKeyframe(1);
    });

    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("7"));
  });

  it("prefetches selected keyframes and loop region endpoints for timeline previews", async () => {
    sessionStorage.setItem(
      videoNavigationStorageKey(manifest.task_id, "loop"),
      JSON.stringify({ startFrame: 2, endFrame: 5 }),
    );
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 7, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await waitFor(() => expect(apiMocks.prefetchVideoFrames).toHaveBeenCalledWith(
      "task-1",
      [0, 7],
      { width: 320, format: "webp" },
    ));
    await waitFor(() => expect(apiMocks.prefetchVideoFrames).toHaveBeenCalledWith(
      "task-1",
      [2, 5],
      { width: 320, format: "webp" },
    ));
  });

  it("toggles bookmarks and navigates explicit seek history through ref controls", async () => {
    const ref = createRef<VideoStageControls>();
    const { getByLabelText, getByTestId } = render(
      <VideoStage
        ref={ref}
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await act(async () => {
      ref.current?.toggleBookmark();
    });
    expect(getByTestId("video-bookmark-marker")).toBeInTheDocument();

    await act(async () => {
      ref.current?.seekByFrames(5);
    });
    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("5"));

    fireEvent.click(getByTestId("video-bookmark-marker"));
    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("0"));

    await act(async () => {
      ref.current?.jumpHistory(-1);
    });
    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("5"));
  });

  it("restores, clears, and applies loop regions while playing", async () => {
    sessionStorage.setItem(
      videoNavigationStorageKey(manifest.task_id, "loop"),
      JSON.stringify({ startFrame: 2, endFrame: 5 }),
    );
    const { container, getByLabelText, getByTestId, getByTitle, queryByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await waitFor(() => expect(getByTestId("video-loop-region")).toBeInTheDocument());
    expect(getByTestId("video-loop-region-label")).toHaveTextContent("Loop 2-5");

    fireEvent.click(getByTitle("播放 / 暂停 (Space)"));
    const video = container.querySelector("video")!;
    video.currentTime = 0.6;
    fireEvent.timeUpdate(video);

    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("2"));

    fireEvent.click(getByTitle("清除播放范围 (Alt+L)"));
    expect(queryByTestId("video-loop-region")).not.toBeInTheDocument();
  });

  it("syncs externally controlled frame changes to the video element", async () => {
    const props = {
      manifest,
      annotations: [] as AnnotationResponse[],
      selectedId: null,
      activeClass: "car",
      frameIndex: 0,
      onSelect: () => {},
      onCreate: () => {},
      onUpdate: () => {},
      onRename: () => {},
    };
    const { container, rerender } = render(<VideoStage {...props} />);
    const video = container.querySelector("video");

    expect(video).not.toBeNull();
    expect(video!.currentTime).toBe(0);

    rerender(<VideoStage {...props} frameIndex={5} />);

    await waitFor(() => expect(video!.currentTime).toBeCloseTo(0.5));
  });

  it("renders playback controls as a floating overlay and hides it while editing", () => {
    const { getByTestId, getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    const playbackOverlay = getByTestId("video-playback-overlay");
    setRect(overlay);

    expect(playbackOverlay).toHaveStyle({ opacity: "1" });
    expect(playbackOverlay).toHaveStyle({ pointerEvents: "none" });

    fireEvent(overlay, pointer("pointerdown", 100, 100));

    expect(playbackOverlay).toHaveStyle({ opacity: "0" });
    expect(getByTitle("播放 / 暂停 (Space)")).toHaveStyle({ pointerEvents: "none" });
  });

  it("keeps playback controls interactive while an editable box is selected", () => {
    const annotations = [
      {
        id: "b1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getByTestId, getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="b1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const stage = getByTestId("video-stage");
    const overlay = getByTestId("video-overlay");
    const playbackOverlay = getByTestId("video-playback-overlay");

    expect(playbackOverlay).toHaveStyle({ opacity: "1" });
    expect(getByTitle("播放 / 暂停 (Space)")).toHaveStyle({ pointerEvents: "auto" });
    expect(overlay).toHaveStyle({ zIndex: "6", pointerEvents: "auto" });

    fireEvent.mouseMove(stage);

    expect(playbackOverlay).toHaveStyle({ opacity: "1" });
    expect(overlay).toHaveStyle({ cursor: "crosshair" });
  });

  it("mounts CVAT-aligned rendering layers in deterministic order", () => {
    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    const surface = getByTestId("video-stage-surface");
    expect([...surface.children].map((node) => (node as HTMLElement).dataset.testid)).toEqual([
      "video-media-layer",
      "video-bitmap-layer",
      "video-grid-layer",
      "video-objects-layer",
      "video-label-overlay",
      "video-overlay",
      "video-attachment-layer",
    ]);
  });

  it("renders a cached ImageBitmap on the bitmap layer and hides it while playing", async () => {
    const { createImageBitmapMock, drawImage } = installBitmapMocks();
    const { getByTestId, getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await waitFor(() => expect(createImageBitmapMock).toHaveBeenCalled());
    const bitmapLayer = getByTestId("video-bitmap-layer");
    await waitFor(() => expect(bitmapLayer).toHaveStyle({ display: "block" }));
    expect(drawImage).toHaveBeenCalled();

    fireEvent.click(getByTitle("播放 / 暂停 (Space)"));

    await waitFor(() => expect(playMock).toHaveBeenCalled());
    await waitFor(() => expect(bitmapLayer).toHaveStyle({ display: "none" }));
  });

  it("falls back without the bitmap layer when ImageBitmap capture is unsupported", async () => {
    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(getByTestId("video-bitmap-layer")).toHaveStyle({ display: "none" });
    await waitFor(() => {
      const diagnostics = (window as any).__videoWorkbenchDiagnostics?.byTask?.["task-1"];
      expect(diagnostics?.bitmapCache?.supported).toBe(false);
    });
  });

  it("clears cached bitmaps when the video task changes", async () => {
    installBitmapMocks();
    const { getByTestId, rerender } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await waitFor(() => expect(getByTestId("video-bitmap-layer")).toHaveStyle({ display: "block" }));

    rerender(
      <VideoStage
        manifest={{ ...manifest, task_id: "task-2" }}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await waitFor(() => expect(closeBitmapMock).toHaveBeenCalled());
  });

  it("supports video viewport fit, 1:1, wheel zoom, and right-button pan", async () => {
    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const stage = getByTestId("video-stage");
    const surface = getByTestId("video-stage-surface");
    const overlay = getByTestId("video-overlay");
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 250,
      right: 500,
      bottom: 250,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    setRect(overlay);
    fireEvent(window, new Event("resize"));

    fireEvent.keyDown(window, { key: "f" });
    await waitFor(() => expect(surface).toHaveStyle({ transform: "translate(0px, 0px) scale(0.5)" }));

    fireEvent.keyDown(window, { key: "0" });
    await waitFor(() => expect(surface).toHaveStyle({ transform: "translate(-250px, -125px) scale(1)" }));

    fireEvent.wheel(stage, { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 125 });
    await waitFor(() => expect(surface.style.transform).toContain("scale(1.1)"));
    expect(getByTestId("minimap-current-frame").parentElement).toHaveStyle({ bottom: "64px" });

    fireEvent(overlay, pointer("pointerdown", 100, 100, 2));
    fireEvent(overlay, pointer("pointermove", 125, 130));
    fireEvent(overlay, pointer("pointerup", 125, 130));

    await waitFor(() => {
      expect(surface.style.transform).toContain("translate(-275px, -120px)");
    });
  });

  it("keeps the pending video box visible while class selection is open", () => {
    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        pendingDrawing={{
          kind: "video_bbox",
          frameIndex: 0,
          geom: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
          anchor: { left: 100, top: 100 },
        }}
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(getByTestId("video-pending-draft")).toBeInTheDocument();
    expect(getByTestId("video-label-overlay")).toHaveTextContent("car");
  });

  it("keeps playback controls available when the selected bbox is on another frame", () => {
    const annotations = [
      {
        id: "b1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getByTestId, getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="b1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(getByTestId("video-playback-overlay")).toHaveStyle({ opacity: "1" });
    expect(getByTestId("video-overlay")).toHaveStyle({ zIndex: "6", pointerEvents: "auto" });
    expect(getByTitle("播放 / 暂停 (Space)")).toHaveStyle({ pointerEvents: "auto" });
  });

  it("renders video quality warnings at the top of the stage", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 40, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    const warnings = getByTestId("video-qc-warnings");
    expect(warnings).toHaveTextContent("car trk_car 关键帧间隔 40 帧");
    expect(warnings).toHaveStyle({ top: "14px" });
    expect(warnings).not.toHaveStyle({ bottom: "14px" });
  });

  it("renders only annotations from the selected frame", () => {
    const annotations = [
      {
        id: "a1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
      {
        id: "a2",
        class_name: "person",
        geometry: { type: "video_bbox", frame_index: 3, x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(getByTestId("video-label-overlay").textContent).toContain("car");
    expect(getByTestId("video-label-overlay").textContent).not.toContain("person");
  });

  it("renders visible screen-pixel strokes for current frame boxes", () => {
    const annotations = [
      {
        id: "a1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { container } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    const svg = container.querySelector('[data-testid="video-objects-layer"]');
    const rect = container.querySelector('[data-testid="video-objects-layer"] rect');
    expect(svg?.getAttribute("viewBox")).toBe("0 0 1 0.5");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(rect?.getAttribute("stroke-width")).toBe("2");
    expect(rect?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(rect?.getAttribute("y")).toBe("0.05");
  });

  it("keeps video labels attached to their frame box", () => {
    const annotations = [
      {
        id: "a1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.86, w: 0.2, h: 0.1 },
      },
    ] as AnnotationResponse[];

    const { container } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    const label = container.querySelector('[data-testid="video-label"]');
    expect(label).toHaveTextContent("car");
    expect(label).toHaveStyle({ left: "10%", top: "86%" });
    expect(container.querySelector("svg foreignObject")).toBeNull();
  });

  it("adds a keyframe to the selected video track", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByTestId, getByLabelText } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        videoTool="track"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });
    fireEvent(overlay, pointer("pointerdown", 400, 100));
    fireEvent(overlay, pointer("pointermove", 600, 250));
    fireEvent(overlay, pointer("pointerup", 600, 250));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes).toHaveLength(2);
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.x).toBeCloseTo(0.4);
  });

  it("shows a nearest-keyframe ghost for selected tracks on empty frames", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });

    expect(getByTestId("video-track-ghost")).toBeInTheDocument();
    expect(getByTestId("video-label-overlay")).toHaveTextContent("car · 参考 F0");

    const sidebar = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={3}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onUpdate={onUpdate}
      />,
    );

    expect(sidebar.getAllByText("手动").length).toBeGreaterThan(0);
    expect(sidebar.getByText(/1 关键帧/)).toHaveTextContent("1 关键帧 · F0");
    expect(sidebar.getAllByText("trk_car").length).toBeGreaterThan(0);

    fireEvent.click(sidebar.getByText("复制到当前帧"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes).toHaveLength(2);
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.x).toBeCloseTo(0.1);
  });

  it("drags the selected-track ghost into a current-frame keyframe", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });
    expect(getByTestId("video-track-ghost")).toBeInTheDocument();

    fireEvent(overlay, pointer("pointerdown", 100, 50));
    fireEvent(overlay, pointer("pointermove", 200, 150));
    fireEvent(overlay, pointer("pointerup", 200, 150));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.x).toBeCloseTo(0.2);
    expect(geometry.keyframes[1].bbox.y).toBeCloseTo(0.3);
  });

  it("resizes a selected video bbox with corner handles", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "b1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getAllByTestId, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="b1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    expect(getAllByTestId("video-resize-handle")).toHaveLength(8);
    expect(getAllByTestId("video-resize-hit-area")).toHaveLength(8);
    const seHitArea = overlay.querySelector('[data-testid="video-resize-hit-area"][data-dir="se"]');
    expect(seHitArea).not.toBeNull();

    fireEvent(seHitArea!, pointer("pointerdown", 300, 150));
    fireEvent(overlay, pointer("pointermove", 400, 200));
    fireEvent(overlay, pointer("pointerup", 400, 200));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry).toMatchObject({ type: "video_bbox", frame_index: 0 });
    expect(geometry.x).toBeCloseTo(0.1);
    expect(geometry.y).toBeCloseTo(0.1);
    expect(geometry.w).toBeCloseTo(0.3);
    expect(geometry.h).toBeCloseTo(0.3);
  });

  it("resizes a selected-track ghost into a current-frame keyframe", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });
    const ghost = getByTestId("video-track-ghost");
    const seHandle = ghost.querySelector('[data-testid="video-resize-handle"][data-dir="se"]');
    expect(seHandle).not.toBeNull();

    fireEvent(seHandle!, pointer("pointerdown", 300, 150));
    fireEvent(overlay, pointer("pointermove", 400, 200));
    fireEvent(overlay, pointer("pointerup", 400, 200));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes).toHaveLength(2);
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.w).toBeCloseTo(0.3);
    expect(geometry.keyframes[1].bbox.h).toBeCloseTo(0.3);
  });

  it("allows resizing the same selected track twice without moving it first", () => {
    const onUpdate = vi.fn();
    const baseTrack: AnnotationResponse = {
      id: "t1",
      class_name: "car",
      geometry: {
        type: "video_track",
        track_id: "trk_car",
        keyframes: [
          { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
        ],
      },
    } as AnnotationResponse;

    const { getByTestId, rerender } = render(
      <VideoStage
        manifest={manifest}
        annotations={[baseTrack]}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    const firstHandle = overlay.querySelector('[data-testid="video-resize-handle"][data-dir="se"]');
    expect(firstHandle).not.toBeNull();
    fireEvent(firstHandle!, pointer("pointerdown", 300, 150));
    fireEvent(overlay, pointer("pointermove", 400, 200));
    fireEvent(overlay, pointer("pointerup", 400, 200));

    const firstGeometry = onUpdate.mock.calls[0][1];
    const resizedTrack = { ...baseTrack, geometry: firstGeometry } as AnnotationResponse;
    rerender(
      <VideoStage
        manifest={manifest}
        annotations={[resizedTrack]}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );

    const secondHandle = getByTestId("video-overlay").querySelector('[data-testid="video-resize-handle"][data-dir="se"]');
    expect(secondHandle).not.toBeNull();
    fireEvent(secondHandle!, pointer("pointerdown", 400, 200));
    fireEvent(getByTestId("video-overlay"), pointer("pointermove", 450, 225));
    fireEvent(getByTestId("video-overlay"), pointer("pointerup", 450, 225));

    expect(onUpdate).toHaveBeenCalledTimes(2);
    const secondGeometry = onUpdate.mock.calls[1][1];
    expect(secondGeometry.keyframes[0].bbox.w).toBeCloseTo(0.35);
    expect(secondGeometry.keyframes[0].bbox.h).toBeCloseTo(0.35);
  });

  it("renders interpolated track boxes between keyframes", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 2, bbox: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "1" } });

    expect(getByTestId("video-track-path-preview")).toBeInTheDocument();
    expect(getByTestId("video-label-overlay").textContent).toContain("car · 插值");
    const label = Array.from(getByTestId("video-label-overlay").querySelectorAll('[data-testid="video-label"]'))
      .find((node) => node.textContent?.includes("car · 插值"));
    expect(label).toHaveStyle({ left: "20%", top: "10%" });
  });

  it("filters video entries by review raw/final display mode", () => {
    const annotations = [
      {
        id: "manual-track",
        class_name: "manual-car",
        geometry: {
          type: "video_track",
          track_id: "trk_manual",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
      {
        id: "prediction-track",
        class_name: "prediction-car",
        geometry: {
          type: "video_track",
          track_id: "trk_prediction",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "prediction" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const raw = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        reviewDisplayMode="raw"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    expect(raw.getByTestId("video-label-overlay")).toHaveTextContent("prediction-car");
    expect(raw.getByTestId("video-label-overlay")).not.toHaveTextContent("manual-car");
    raw.unmount();

    const final = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        reviewDisplayMode="final"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    expect(final.getByTestId("video-label-overlay")).toHaveTextContent("manual-car");
    expect(final.getByTestId("video-label-overlay")).not.toHaveTextContent("prediction-car");
  });

  it("does not interpolate across an absent keyframe", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 1, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "manual", absent: true },
            { frame_index: 2, bbox: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "1" } });

    expect(getByTestId("video-overlay").textContent).not.toContain("car");
  });

  it("does not render track boxes on outside frames", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          outside: [{ from: 1, to: 1 }],
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 2, bbox: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "1" } });

    expect(getByTestId("video-overlay").textContent).not.toContain("car");
  });

  it("renders selected track timeline and global density timeline", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          outside: [{ from: 4, to: 5 }],
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 3, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "prediction" },
            { frame_index: 8, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const selected = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(selected.getByTestId("video-track-timeline")).toBeInTheDocument();
    expect(selected.getAllByTestId("video-timeline-track-keyframe")).toHaveLength(3);
    expect(selected.getByTestId("video-timeline-interpolated")).toBeInTheDocument();
    expect(selected.getByTestId("video-timeline-outside")).toBeInTheDocument();
    selected.unmount();

    const global = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(global.getByTestId("video-timeline-density")).toBeInTheDocument();
  });

  it("does not reset frame or selection when callback references change for the same task", () => {
    const firstSelect = vi.fn();
    const secondSelect = vi.fn();
    const { rerender } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={firstSelect}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(firstSelect).toHaveBeenCalledWith(null);

    rerender(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={secondSelect}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(secondSelect).not.toHaveBeenCalled();
  });

  it("allows reviewers to select boxes in read-only mode", () => {
    const onSelect = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        readOnly
        onSelect={onSelect}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    onSelect.mockClear();

    const overlay = getByTestId("video-overlay");
    setRect(overlay);
    fireEvent(overlay, pointer("pointerdown", 100, 100));

    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("routes selected object class changes through the class picker flow", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const onChangeUserBoxClass = vi.fn();
    const annotations = [
      {
        id: "b1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="b1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
        onChangeUserBoxClass={onChangeUserBoxClass}
      />,
    );

    fireEvent.click(getByTitle("修改类别"));

    expect(onChangeUserBoxClass).toHaveBeenCalledWith("b1");
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("routes track row rename through the class picker flow", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const onChangeUserBoxClass = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByTitle } = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onUpdate={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onChangeUserBoxClass={onChangeUserBoxClass}
      />,
    );

    fireEvent.click(getByTitle("重命名轨迹类别"));

    expect(onChangeUserBoxClass).toHaveBeenCalledWith("t1");
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("seeks to the first visible keyframe when selecting a track row", () => {
    const onSelect = vi.fn();
    const onSeekFrame = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 9, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 3, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByTestId } = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId={null}
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={onSelect}
        onUpdate={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onSeekFrame={onSeekFrame}
      />,
    );

    fireEvent.click(getByTestId("video-track-row"));

    expect(onSeekFrame).toHaveBeenCalledWith(3);
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("clears the selected track so the next track draw creates a new track", () => {
    const onSelect = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByText } = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={onSelect}
        onUpdate={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
      />,
    );

    fireEvent.click(getByText("新建轨迹"));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("filters track rows to tracks present on the current frame", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
      {
        id: "t2",
        class_name: "person",
        geometry: {
          type: "video_track",
          track_id: "trk_person",
          keyframes: [
            { frame_index: 3, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const view = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId={null}
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onUpdate={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
      />,
    );

    expect(view.getAllByTestId("video-track-row")).toHaveLength(2);

    const filter = view.getByRole("tablist", { name: "轨迹过滤" });
    expect(within(filter).queryByText("隐藏")).not.toBeInTheDocument();
    fireEvent.click(within(filter).getByText("当前帧"));

    expect(view.getAllByTestId("video-track-row")).toHaveLength(1);
    expect(view.getByText("car")).toBeInTheDocument();
    expect(view.queryByText("person")).not.toBeInTheDocument();
  });

  it("shows track source and jumps to the next prediction keyframe", () => {
    const onSeekFrame = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 4, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "prediction" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const view = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onUpdate={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onSeekFrame={onSeekFrame}
      />,
    );

    expect(view.getByTestId("video-track-current-source")).toHaveTextContent("manual");
    fireEvent.click(view.getByText("下一预测"));
    expect(onSeekFrame).toHaveBeenCalledWith(4);
  });

  it("multi-selects tracks in the sidebar and routes batch actions", async () => {
    const onRenameTracks = vi.fn();
    const onToggleHiddenTrack = vi.fn();
    const onToggleLockedTrack = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
      {
        id: "t2",
        class_name: "person",
        geometry: {
          type: "video_track",
          track_id: "trk_person",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getAllByTestId, getByLabelText, getByTestId, getByText } = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        classes={["car", "person", "bus"]}
        onSelect={() => {}}
        onToggleHiddenTrack={onToggleHiddenTrack}
        onToggleLockedTrack={onToggleLockedTrack}
        onRenameTracks={onRenameTracks}
        onUpdate={() => {}}
      />,
    );

    fireEvent.click(getAllByTestId("video-track-row")[1], { shiftKey: true });

    await waitFor(() => expect(getByTestId("video-track-batch-toolbar")).toHaveTextContent("已选 2 条轨迹"));

    fireEvent.change(getByLabelText("批量改类"), { target: { value: "bus" } });
    expect(onRenameTracks).toHaveBeenCalledWith(annotations, "bus");

    fireEvent.click(within(getByTestId("video-track-batch-toolbar")).getByText("隐藏"));
    expect(onToggleHiddenTrack).toHaveBeenCalledWith("trk_car");
    expect(onToggleHiddenTrack).toHaveBeenCalledWith("trk_person");

    fireEvent.click(getByText("锁定"));
    expect(onToggleLockedTrack).toHaveBeenCalledWith("trk_car");
    expect(onToggleLockedTrack).toHaveBeenCalledWith("trk_person");
  });

  it("routes selected video bboxes to aggregate composition", () => {
    const onComposeTracks = vi.fn();
    const annotations = [
      {
        id: "b1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
      {
        id: "b2",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 3, x: 0.2, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const view = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="b2"
        selectedIds={["b1", "b2"]}
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onUpdate={() => {}}
        onComposeTracks={onComposeTracks}
      />,
    );

    fireEvent.click(view.getByTitle("把已多选的单帧 video_bbox 聚合为一条 video_track"));

    expect(onComposeTracks).toHaveBeenCalledWith({
      operation: "aggregate_bboxes",
      annotationIds: ["b1", "b2"],
      deleteSources: true,
    });
  });

  it("routes current-track split and same-class two-track merge", async () => {
    const onComposeTracks = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
      {
        id: "t2",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car_tail",
          keyframes: [
            { frame_index: 4, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const view = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onUpdate={() => {}}
        onComposeTracks={onComposeTracks}
      />,
    );

    fireEvent.click(view.getByText("拆轨迹"));
    expect(onComposeTracks).toHaveBeenCalledWith({
      operation: "split_track",
      annotationIds: ["t1"],
      frameIndex: 0,
    });

    fireEvent.click(view.getAllByTestId("video-track-row")[1], { shiftKey: true });
    await waitFor(() => expect(view.getByTestId("video-track-batch-toolbar")).toHaveTextContent("已选 2 条轨迹"));
    fireEvent.click(within(view.getByTestId("video-track-batch-toolbar")).getByText("合并"));

    expect(onComposeTracks).toHaveBeenLastCalledWith({
      operation: "merge_tracks",
      annotationIds: ["t1", "t2"],
    });
  });

  it("copies the current keyframe and pastes it to the current frame", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 3, bbox: { x: 0.5, y: 0.2, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const view = render(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={0}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(view.getByTitle("复制当前轨迹在当前帧的关键帧"));
    expect(view.getByText(/已复制:/).textContent).toContain("F0");

    view.rerender(
      <VideoTrackSidebar
        annotations={annotations}
        selectedId="t1"
        frameIndex={3}
        readOnly={false}
        hiddenTrackIds={new Set()}
        lockedTrackIds={new Set()}
        onSelect={() => {}}
        onToggleHiddenTrack={() => {}}
        onToggleLockedTrack={() => {}}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(view.getByTitle("把已复制的关键帧粘贴到当前帧"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    const pasted = (geometry.keyframes as Array<{ frame_index: number; bbox: { x: number; y: number } }>)
      .find((kf) => kf.frame_index === 3);
    expect(pasted?.bbox.x).toBeCloseTo(0.1);
    expect(pasted?.bbox.y).toBeCloseTo(0.1);
  });
});
