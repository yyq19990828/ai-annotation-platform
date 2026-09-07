/**
 * v0.16.1 · 视频 Konva 栈容器(VideoKonvaStage)konva-mock 测试。
 *
 * 验证容器层装配:渲染隐藏 `<video>` 解码源 + media-bg Layer + Konva.Image(world 尺寸按
 * manifest 固有宽高),并经转发的 VideoStageControls 暴露播放控制(供工作台热键驱动)。
 * 真实 canvas 渲染 / 播放重绘交给 Playwright,本测试只验装配与 props(决策 C)。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { VideoKonvaStage } from "./VideoKonvaStage";
import type { VideoStageControls } from "./videoStageControls";
import type { AnnotationResponse, TaskVideoManifestResponse } from "@/types";
import type { UseMaskEditorReturn } from "../state/useMaskEditor";
import { useWorkbenchHotkeys, type UseWorkbenchHotkeysArgs } from "../state/useWorkbenchHotkeys";

vi.mock("./useVideoPreciseFrame", () => ({
  useVideoPreciseFrame: () => ({
    active: false,
    bitmap: null,
    sourceState: "disabled",
    fallbackReason: null,
    diagnostics: {
      supported: false,
      webcodecsEnabled: false,
      decoderActive: false,
      chunkId: null,
      datasetItemId: null,
      chunkSizeFrames: null,
      decodeRequests: 0,
      decoderErrors: 0,
      urlRefreshed: false,
    },
    performance: {
      manifestCacheHits: 0,
      samplesCacheHits: 0,
      chunkByteCacheHits: 0,
      bitmapCacheHits: 0,
      bytesFetched: 0,
      bitmapBytes: 0,
      bitmapBudgetBytes: 0,
      activeDecoders: 0,
      liveVideoFrames: 0,
      chunkBytes: 0,
      chunkBudgetBytes: 0,
      sessionCreates: 0,
      sessionResets: 0,
      sessionDisposals: 0,
      encodedChunksSubmitted: 0,
      staleResults: 0,
      prefetchRequests: 0,
      prefetchHits: 0,
      evictions: 0,
      lastManifestMs: null,
      lastSamplesMs: null,
      lastChunkFetchMs: null,
      lastDemuxMs: null,
      lastQueueMs: null,
      lastCodecMs: null,
      lastDecodeMs: null,
      lastBitmapMs: null,
      lastDecodeMode: null,
      lastPaintMs: null,
      lastVisibleMs: null,
      paintedFrameIndex: null,
      gopStartDecodeIndex: null,
      targetTimestampUs: null,
      codec: null,
    },
    markFramePainted: vi.fn(),
  }),
}));

const playMock = vi.fn();
const pauseMock = vi.fn();

function makeMaskEditor(overrides: Partial<UseMaskEditorReturn> = {}) {
  return {
    active: true,
    dirty: true,
    phase: "dirty",
    buffer: null,
    tool: "brush",
    mode: "brush",
    radius: 8,
    backend: "dense",
    operationPreview: null,
    instanceOperationPreview: null,
    setMode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    confirmOperation: vi.fn(),
    cancelOperation: vi.fn(),
    ...overrides,
  } as unknown as UseMaskEditorReturn;
}

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

describe("VideoKonvaStage · konva mock", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: pauseMock,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: playMock,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
  });
  afterAll(() => {
    playMock.mockReset();
    pauseMock.mockReset();
  });

  it("渲染隐藏 video 源 + media-bg Layer + Konva.Image(world 尺寸 = manifest 固有宽高)", () => {
    render(<VideoKonvaStage manifest={manifest} />);

    expect(document.querySelector('[data-testid="video-konva-stage"]')).not.toBeNull();
    const source = document.querySelector(
      '[data-testid="video-konva-source"]',
    ) as HTMLVideoElement | null;
    expect(source).not.toBeNull();
    expect(source!.getAttribute("src")).toBe(manifest.video_url);

    const layer = document.querySelector('[data-konva="Layer"]');
    expect(layer?.getAttribute("data-testid")).toBe("media-bg");
    const image = document.querySelector('[data-konva="Image"]');
    expect(image).not.toBeNull();
    expect(image!.getAttribute("data-width")).toBe("1000");
    expect(image!.getAttribute("data-height")).toBe("500");
    // data-video-frame-source 暴露当前显示来源(webcodecs / native bitmap / video element),供 E2E 与诊断。
    const stage = document.querySelector('[data-testid="video-konva-stage"]') as HTMLElement;
    expect(["webcodecs", "native-bitmap", "video"]).toContain(
      stage.getAttribute("data-video-frame-source"),
    );
  });

  it("loading 态显示占位,不渲染 Stage", () => {
    render(<VideoKonvaStage manifest={undefined} isLoading />);
    expect(document.querySelector('[data-testid="video-konva-stage"]')).toBeNull();
    expect(document.querySelector('[data-konva="Stage"]')).toBeNull();
  });

  it("工具与审阅浮层位于轨迹条下方，共享画布坐标而不冒泡到绘制容器", () => {
    render(
      <VideoKonvaStage
        manifest={manifest}
        overlays={<button data-testid="tool-overlay">工具</button>}
      />,
    );
    const canvas = screen.getByTestId("video-konva-stage");
    const bar = screen.getByTestId("video-track-context-bar");
    const overlay = screen.getByTestId("tool-overlay");
    expect(canvas.contains(overlay)).toBe(false);
    expect(canvas.parentElement).toBe(overlay.parentElement);
    expect(canvas.parentElement?.previousElementSibling).toBe(bar);
  });

  function contextAnnotation(
    type: "video_track_bbox" | "video_track_polygon" | "video_track_polyline",
  ): AnnotationResponse {
    const shape =
      type === "video_track_bbox"
        ? { bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }
        : {
            points: [
              [0.1, 0.1],
              [0.4, 0.1],
              [0.4, 0.4],
            ],
          };
    return {
      id: "context-annotation",
      task_id: "task-1",
      source: "manual",
      annotation_type: type,
      class_name: "car",
      is_active: true,
      attributes: {},
      confidence: 1,
      parent_prediction_id: null,
      created_at: "2026-09-07T00:00:00Z",
      updated_at: null,
      geometry: {
        type,
        track_id: "trk_context",
        keyframes: [0, 8].map((frame_index) => ({ frame_index, source: "manual", ...shape })),
      },
    } as AnnotationResponse;
  }

  it.each(["video_track_bbox", "video_track_polygon", "video_track_polyline"] as const)(
    "%s 的轨迹条将真实插值物化为人工关键帧，保留原端点",
    (type) => {
      const annotation = contextAnnotation(type);
      const onUpdate = vi.fn();
      render(
        <VideoKonvaStage
          manifest={manifest}
          annotations={[annotation]}
          selectedId={annotation.id}
          frameIndex={4}
          onUpdate={onUpdate}
        />,
      );
      const bar = within(screen.getByTestId("video-track-context-bar"));
      expect(bar.getByTestId("video-track-context-state")).toHaveAttribute(
        "data-state",
        "interpolated",
      );
      fireEvent.click(bar.getByRole("button", { name: "补关键帧" }));
      expect(onUpdate).toHaveBeenCalledOnce();
      const [owner, geometry] = onUpdate.mock.calls[0];
      expect(owner).toBe(annotation);
      expect(geometry.type).toBe(type);
      expect(
        geometry.keyframes.map((keyframe: { frame_index: number }) => keyframe.frame_index),
      ).toEqual([0, 4, 8]);
      expect(geometry.keyframes[1].source).toBe("manual");
      expect("keyframes" in annotation.geometry).toBe(true);
      if ("keyframes" in annotation.geometry) {
        expect(geometry.keyframes[0]).toEqual(annotation.geometry.keyframes[0]);
        expect(geometry.keyframes[2]).toEqual(annotation.geometry.keyframes[1]);
      }
    },
  );

  it.each(["readOnly", "annotationLock", "trackLock", "draft", "maskDraft"] as const)(
    "%s 阻止轨迹条写入，读取帧状态仍可用",
    (guard) => {
      const annotation = contextAnnotation("video_track_bbox");
      if (guard === "annotationLock") annotation.is_locked = true;
      const onUpdate = vi.fn();
      const onPropagateTrack = vi.fn();
      const ref = createRef<VideoStageControls>();
      render(
        <VideoKonvaStage
          ref={ref}
          manifest={manifest}
          annotations={[annotation]}
          selectedId={annotation.id}
          frameIndex={4}
          onUpdate={onUpdate}
          onPropagateTrack={onPropagateTrack}
          readOnly={guard === "readOnly"}
          lockedTrackIds={guard === "trackLock" ? new Set(["trk_context"]) : new Set()}
          pendingDrawing={
            guard === "draft"
              ? {
                  kind: "video_bbox",
                  frameIndex: 4,
                  geom: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
                  anchor: { left: 0, top: 0 },
                }
              : null
          }
          maskEditor={guard === "maskDraft" ? makeMaskEditor() : undefined}
        />,
      );
      const bar = within(screen.getByTestId("video-track-context-bar"));
      expect(bar.queryByRole("button", { name: "补关键帧" })).toBeNull();
      expect(bar.queryByRole("button", { name: "标记 outside" })).toBeNull();
      expect(bar.queryByRole("button", { name: "延展轨迹" })).toBeNull();
      expect(bar.getByRole("button", { name: "下一关键帧" })).toBeEnabled();
      if (["readOnly", "annotationLock", "trackLock"].includes(guard)) {
        act(() => ref.current?.toggleSelectedTrackOutside());
        act(() => ref.current?.propagateSelectedTrack());
        expect(onUpdate).not.toHaveBeenCalled();
        expect(onPropagateTrack).not.toHaveBeenCalled();
      }
    },
  );

  it("转发的 VideoStageControls 暴露播放控制(togglePlayback 触发 video.play)", () => {
    const ref = createRef<VideoStageControls>();
    render(<VideoKonvaStage ref={ref} manifest={manifest} />);
    expect(typeof ref.current?.togglePlayback).toBe("function");
    expect(typeof ref.current?.seekToFrameReady).toBe("function");
    expect(typeof ref.current?.focusRegion).toBe("function");
    expect(ref.current?.deleteSelectedTrackKeyframe()).toBe(false); // 轨迹类 no-op
    playMock.mockClear();
    act(() => ref.current?.togglePlayback());
    expect(playMock).toHaveBeenCalled();
  });

  it("settings scrolling and draft keys leave the underlying video stage untouched", () => {
    const view = render(<VideoKonvaStage manifest={manifest} videoTool="polygon" />);
    const stage = view.getByTestId("video-konva-stage");
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 500));
    const settings = document.createElement("button");
    settings.dataset.workbenchSettings = "";
    settings.dataset.state = "open";
    document.body.append(settings);
    const events = [
      new WheelEvent("wheel", {
        clientX: 100,
        clientY: 100,
        ctrlKey: true,
        deltaY: -10,
        bubbles: true,
        cancelable: true,
      }),
      ...["Enter", "Escape", "Backspace"].map(
        (key) => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      ),
    ];
    act(() => events.forEach((event) => settings.dispatchEvent(event)));
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
    settings.remove();

    const wheel = new WheelEvent("wheel", {
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      deltaY: -10,
      cancelable: true,
    });
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    act(() => {
      window.dispatchEvent(wheel);
      window.dispatchEvent(enter);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
  });

  it.each(["mask", "mask-track"] as const)(
    "%s sends every editor phase to the primary/secondary owner",
    (videoTool) => {
      const onMaskCommit = vi.fn();
      const onMaskCancel = vi.fn();
      const states: Partial<UseMaskEditorReturn>[] = [
        { active: false, dirty: false, phase: "idle" },
        { dirty: false, phase: "ready" },
        { phase: "dirty" },
        { phase: "saving" },
        { operationPreview: { id: 1, alpha: new Uint8Array(0) } as never },
        { instanceOperationPreview: { id: 2, plan: { focusAlpha: new Uint8Array(0) } } as never },
      ];
      const view = render(<VideoKonvaStage manifest={manifest} />);
      states.forEach((state, index) => {
        const editor = makeMaskEditor(state);
        view.rerender(
          <VideoKonvaStage
            manifest={manifest}
            videoTool={videoTool}
            maskEditor={editor}
            onMaskCommit={onMaskCommit}
            onMaskCancel={onMaskCancel}
          />,
        );
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        });
        expect(onMaskCommit).toHaveBeenCalledTimes(index + 1);
        expect(onMaskCancel).toHaveBeenCalledTimes(index + 1);
        expect(editor.confirmOperation).not.toHaveBeenCalled();
        expect(editor.cancelOperation).not.toHaveBeenCalled();
      });
    },
  );

  it("pixel read-only blocks brush/undo while the primary owner decides whether saving is allowed", () => {
    const editor = makeMaskEditor();
    const onMaskCommit = vi.fn();
    const view = render(
      <VideoKonvaStage
        manifest={manifest}
        videoTool="mask"
        maskEditor={editor}
        onMaskCommit={onMaskCommit}
        readOnly
      />,
    );
    const key = (key: string, ctrlKey = false) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, cancelable: true }));
    act(() => {
      key("b");
      key("e");
      key("z", true);
      key("Enter");
    });
    expect(onMaskCommit).toHaveBeenCalledTimes(1);
    expect(editor.setMode).not.toHaveBeenCalled();
    expect(editor.undo).not.toHaveBeenCalled();
    view.rerender(<VideoKonvaStage manifest={manifest} videoTool="mask" maskEditor={editor} />);
    act(() => {
      key("b");
      key("e");
      key("z", true);
      key("y", true);
    });
    expect(editor.setMode).toHaveBeenNthCalledWith(1, "brush");
    expect(editor.setMode).toHaveBeenNthCalledWith(2, "erase");
    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(editor.redo).toHaveBeenCalledTimes(1);
  });

  it.each([
    "input",
    "textarea",
    "select",
    "contenteditable",
    "combobox",
    "listbox",
    "menu",
    "dialog",
    "button",
  ])("video Mask leaves %s keys with the focused control", (kind) => {
    const onMaskCommit = vi.fn();
    const onMaskCancel = vi.fn();
    render(
      <VideoKonvaStage
        manifest={manifest}
        videoTool="mask"
        maskEditor={makeMaskEditor()}
        onMaskCommit={onMaskCommit}
        onMaskCancel={onMaskCancel}
      />,
    );
    const element = document.createElement(
      ["input", "textarea", "select", "button"].includes(kind) ? kind : "div",
    );
    if (kind === "contenteditable") element.setAttribute("contenteditable", "true");
    else if (!["input", "textarea", "select", "button"].includes(kind))
      element.setAttribute("role", kind);
    const target = ["contenteditable", "combobox", "listbox", "menu", "dialog", "button"].includes(
      kind,
    )
      ? element.appendChild(document.createElement("span"))
      : element;
    const ownKeys = vi.fn();
    element.addEventListener("keydown", ownKeys);
    document.body.append(element);
    try {
      const keys = kind === "button" ? ["Enter"] : ["Enter", "Escape"];
      const events = keys.map(
        (key) => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      act(() => events.forEach((event) => target.dispatchEvent(event)));
      expect(ownKeys).toHaveBeenCalledTimes(keys.length);
      expect(events.every((event) => !event.defaultPrevented)).toBe(true);
      expect(onMaskCommit).not.toHaveBeenCalled();
      expect(onMaskCancel).not.toHaveBeenCalled();
    } finally {
      element.remove();
    }
  });

  it.each([
    ["long press", { repeat: true }],
    ["IME composition", { isComposing: true }],
    ["IME legacy key", { keyCode: 229 }],
    ["already handled", {}],
  ] as const)("video Mask ignores %s", (name, init) => {
    const editor = makeMaskEditor();
    const onMaskCommit = vi.fn();
    const onMaskCancel = vi.fn();
    render(
      <VideoKonvaStage
        manifest={manifest}
        videoTool="mask-track"
        maskEditor={editor}
        onMaskCommit={onMaskCommit}
        onMaskCancel={onMaskCancel}
      />,
    );
    act(() => {
      for (const key of ["Enter", "Escape", "b", "e", "z"]) {
        const event = new KeyboardEvent("keydown", {
          ...init,
          key,
          ctrlKey: key === "z",
          cancelable: true,
        });
        if (name === "already handled") event.preventDefault();
        window.dispatchEvent(event);
      }
    });
    expect(onMaskCommit).not.toHaveBeenCalled();
    expect(onMaskCancel).not.toHaveBeenCalled();
    expect(editor.setMode).not.toHaveBeenCalled();
    expect(editor.undo).not.toHaveBeenCalled();
  });

  it("video Mask lets an unfocused context menu receive Esc", () => {
    const onMaskCancel = vi.fn();
    const setVideoTool = vi.fn();
    render(
      <VideoKonvaStage
        manifest={manifest}
        videoTool="mask"
        maskEditor={makeMaskEditor()}
        onMaskCancel={onMaskCancel}
      />,
    );
    renderHook(() =>
      useWorkbenchHotkeys({
        videoMode: true,
        s: { tool: "select", videoTool: "mask", selectedIds: [], setVideoTool },
        stageGeom: { imgW: 1000, imgH: 500 },
      } as unknown as UseWorkbenchHotkeysArgs),
    );
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    const close = vi.fn(() => menu.remove());
    document.addEventListener("keydown", close);
    try {
      act(() =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        ),
      );
      expect(close).toHaveBeenCalledTimes(1);
      expect(onMaskCancel).not.toHaveBeenCalled();
      expect(setVideoTool).not.toHaveBeenCalled();
    } finally {
      menu.remove();
      document.removeEventListener("keydown", close);
    }
  });
});
