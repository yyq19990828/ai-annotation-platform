// 视频播放控制器单测(子 hook 全 mock):聚焦确定性 state ——
// 播放浮层 show/2s 自动隐藏(v0.16.x 回归修复)、loopRegion 规范化/清除、书签开合、派生 maxFrame。
// rAF/bitmap/seek 等时序路径不在此覆盖(需真实 <video>/解码,留作 e2e/手测)。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./useFrameClock", () => ({
  useFrameClock: () => ({ seekToAsync: vi.fn().mockResolvedValue({ ok: true, frame: 0 }), isSeeking: false }),
}));
vi.mock("./useVideoBitmapCache", () => ({
  useVideoBitmapCache: () => ({ activeBitmap: null, cachedRanges: [], capture: vi.fn(), showFrame: vi.fn() }),
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

import { useVideoPlaybackController } from "./useVideoPlaybackController";

const MANIFEST = {
  task_id: "T1",
  video_url: "http://x/v.mp4",
  metadata: { fps: 30, frame_count: 100 },
} as never;

function setup() {
  const videoRef = { current: null };
  return renderHook(() =>
    useVideoPlaybackController({
      manifest: MANIFEST,
      videoRef,
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
});
