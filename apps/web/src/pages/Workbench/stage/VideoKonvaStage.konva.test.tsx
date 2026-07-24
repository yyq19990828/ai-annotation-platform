/**
 * v0.16.1 · 视频 Konva 栈容器(VideoKonvaStage)konva-mock 测试。
 *
 * 验证容器层装配:渲染隐藏 `<video>` 解码源 + media-bg Layer + Konva.Image(world 尺寸按
 * manifest 固有宽高),并经转发的 VideoStageControls 暴露播放控制(供工作台热键驱动)。
 * 真实 canvas 渲染 / 播放重绘交给 Playwright,本测试只验装配与 props(决策 C)。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { VideoKonvaStage } from "./VideoKonvaStage";
import type { VideoStageControls } from "./videoStageControls";
import type { TaskVideoManifestResponse } from "@/types";

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
      lastDecodeMs: null,
      lastBitmapMs: null,
      gopStartDecodeIndex: null,
      targetTimestampUs: null,
      codec: null,
    },
  }),
}));

const playMock = vi.fn();
const pauseMock = vi.fn();

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
});
