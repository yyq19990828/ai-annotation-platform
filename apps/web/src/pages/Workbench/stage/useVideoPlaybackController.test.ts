// 视频播放控制器单测(子 hook 全 mock):聚焦确定性 state ——
// 播放浮层 show/2s 自动隐藏(v0.16.x 回归修复)、loopRegion 规范化/清除、书签开合、派生 maxFrame。
// rAF/bitmap/seek 等时序路径不在此覆盖(需真实 <video>/解码,留作 e2e/手测)。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const videoHookMocks = vi.hoisted(() => ({
  activeBitmap: null as {
    frameIndex: number;
    bitmap: ImageBitmap;
    width: number;
    height: number;
  } | null,
  preciseBitmap: null as {
    frameIndex: number;
    bitmap: ImageBitmap;
    width: number;
    height: number;
  } | null,
  imageBitmapToJpeg: vi.fn().mockResolvedValue(null),
  videoElementToJpeg: vi.fn().mockResolvedValue(null),
}));

vi.mock("./useFrameClock", () => ({
  useFrameClock: () => ({
    seekToAsync: vi.fn().mockResolvedValue({ ok: true, frame: 0 }),
    isSeeking: false,
  }),
}));
vi.mock("./useVideoBitmapCache", () => ({
  useVideoBitmapCache: () => ({
    activeBitmap: videoHookMocks.activeBitmap,
    cachedRanges: [],
    capture: vi.fn(),
    showFrame: vi.fn(),
  }),
}));
vi.mock("./useVideoPreciseFrame", () => ({
  useVideoPreciseFrame: () => ({
    active: false,
    bitmap: videoHookMocks.preciseBitmap,
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
vi.mock("./useVideoFramePreview", () => ({
  useVideoFramePreview: () => ({ preview: null, previewFor: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("./useVideoTrackActions", () => ({
  useVideoTrackActions: () => ({
    selectedTrackLocked: false,
    toggleSelectedTrackOutside: vi.fn(),
    toggleSelectedTrackOccluded: vi.fn(),
    toggleSelectedTrackHidden: vi.fn(),
    toggleSelectedTrackLocked: vi.fn(),
    propagateSelectedTrack: vi.fn(),
  }),
}));
vi.mock("@/utils/imageBitmapToJpeg", () => ({
  imageBitmapToJpeg: videoHookMocks.imageBitmapToJpeg,
  videoElementToJpeg: videoHookMocks.videoElementToJpeg,
}));

import { useVideoPlaybackController } from "./useVideoPlaybackController";

const MANIFEST = {
  task_id: "T1",
  video_url: "http://x/v.mp4",
  metadata: { fps: 30, frame_count: 100 },
} as never;

/** 最小可用的 <video> 替身:满足 hook 各 effect 挂监听 / 读 readyState / 调 load()。 */
function mockVideo(readyState = 0) {
  return {
    readyState,
    isConnected: true,
    videoWidth: 0,
    videoHeight: 0,
    error: null,
    paused: true,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function setup(videoRef: { current: unknown } = { current: null }) {
  return renderHook(() =>
    useVideoPlaybackController({
      manifest: MANIFEST,
      videoRef: videoRef as never,
      annotations: [],
      selectedId: null,
      selectedTrack: null,
      hiddenTrackIds: new Set<string>(),
      lockedTrackIds: new Set<string>(),
      readOnly: false,
      drag: null,
      currentFrameEntries: [],
      onUpdate: vi.fn(),
    }),
  );
}

describe("useVideoPlaybackController", () => {
  beforeEach(() => {
    localStorage.clear();
    videoHookMocks.activeBitmap = null;
    videoHookMocks.preciseBitmap = null;
    videoHookMocks.imageBitmapToJpeg.mockClear();
    videoHookMocks.videoElementToJpeg.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("派生 maxFrame = frame_count - 1", () => {
    const { result } = setup();
    expect(result.current.maxFrame).toBe(99);
    expect(result.current.fps).toBe(30);
  });

  it("暂停态仅显示当前帧 bitmap，不复用上一帧缓存", () => {
    videoHookMocks.activeBitmap = {
      frameIndex: 1,
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      width: 4,
      height: 4,
    };
    const { result } = setup();

    expect(result.current.frameIndex).toBe(0);
    expect(result.current.displayBitmap).toBeNull();
    expect(result.current.frameSource).toBe("video-element");
  });

  it("暂停态 precise bitmap 优先于同帧 native bitmap，并作为 AI 取帧源", async () => {
    const nativeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const preciseBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    videoHookMocks.activeBitmap = {
      frameIndex: 0,
      bitmap: nativeBitmap,
      width: 4,
      height: 4,
    };
    videoHookMocks.preciseBitmap = {
      frameIndex: 0,
      bitmap: preciseBitmap,
      width: 4,
      height: 4,
    };
    const { result } = setup();

    expect(result.current.displayBitmap?.bitmap).toBe(preciseBitmap);
    expect(result.current.frameSource).toBe("webcodecs");
    await act(async () => {
      await result.current.controls.captureCurrentFrameJpeg();
    });
    expect(videoHookMocks.imageBitmapToJpeg).toHaveBeenCalledWith(preciseBitmap, undefined);
    expect(videoHookMocks.videoElementToJpeg).not.toHaveBeenCalled();
  });

  it("播放态强制使用 video 元素，AI 取帧不读取 bitmap", async () => {
    videoHookMocks.activeBitmap = {
      frameIndex: 0,
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      width: 4,
      height: 4,
    };
    const video = mockVideo(HTMLMediaElement.HAVE_METADATA);
    const { result } = setup({ current: video });
    expect(result.current.frameSource).toBe("video-bitmap");

    act(() => result.current.controls.togglePlayback());
    expect(result.current.isPlaybackActive).toBe(true);
    expect(result.current.displayBitmap).toBeNull();
    expect(result.current.frameSource).toBe("video-element");

    await act(async () => {
      await result.current.controls.captureCurrentFrameJpeg();
    });
    expect(videoHookMocks.videoElementToJpeg).toHaveBeenCalledWith(video, undefined);
    expect(videoHookMocks.imageBitmapToJpeg).not.toHaveBeenCalled();
  });

  it("播放浮层:默认显示 → schedule 后 2s 自动隐藏 → show 再次唤出并取消隐藏", () => {
    const { result } = setup();
    expect(result.current.playbackOverlayVisible).toBe(true);

    act(() => result.current.schedulePlaybackOverlayHide());
    expect(result.current.playbackOverlayVisible).toBe(true); // 尚未到点
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.playbackOverlayVisible).toBe(false);

    act(() => result.current.showPlaybackOverlay());
    expect(result.current.playbackOverlayVisible).toBe(true);
    // show 已清掉隐藏计时器:再推进时间不应又隐藏。
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.playbackOverlayVisible).toBe(true);
  });

  it("loopRegion:设区间被规范化(裁剪到 [0,maxFrame] 且首尾有序);clear 置空", () => {
    const { result } = setup();
    expect(result.current.loopRegion).toBeNull();
    act(() => result.current.setNormalizedLoopRegion({ startFrame: 80, endFrame: 999 }));
    expect(result.current.loopRegion).toEqual({ startFrame: 80, endFrame: 99 });
    act(() => result.current.clearLoopRegion());
    expect(result.current.loopRegion).toBeNull();
  });

  it("书签:toggle 在当前帧加书签,再 toggle 移除", () => {
    const { result } = setup();
    expect(result.current.bookmarks).toHaveLength(0);
    act(() => result.current.toggleBookmark());
    expect(result.current.bookmarks).toHaveLength(1);
    act(() => result.current.toggleBookmark());
    expect(result.current.bookmarks).toHaveLength(0);
  });

  it("加载卡死看门狗:video 卡在 readyState 0 → 每 5s video.load() 重踢, 至多 3 次", () => {
    const video = mockVideo(0);
    setup({ current: video });
    expect(video.load).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(video.load).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(video.load).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(5000));
    expect(video.load).toHaveBeenCalledTimes(3);
    // 达到 MAX_RETRIES 后不再重踢(避免无限重试)。
    act(() => vi.advanceTimersByTime(15000));
    expect(video.load).toHaveBeenCalledTimes(3);
  });

  it("加载卡死看门狗:期间拿到元数据(readyState≥HAVE_METADATA)则不再重踢", () => {
    const video = mockVideo(0);
    setup({ current: video });
    video.readyState = HTMLMediaElement.HAVE_METADATA; // 加载恢复
    act(() => vi.advanceTimersByTime(15000));
    expect(video.load).not.toHaveBeenCalled();
  });
});
