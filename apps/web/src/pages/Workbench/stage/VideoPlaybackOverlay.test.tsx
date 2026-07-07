import { fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  VideoPlaybackOverlay,
  densityBinGradient,
  resolveLargeFrameStep,
} from "./VideoPlaybackOverlay";
import { getTrackColor } from "./colors";
import { buildFrameTimebase } from "./frameTimebase";
import type { VideoTimelineDensityBin, VideoTrackTimeline } from "./videoTrackTimeline";

const timebase = buildFrameTimebase({
  duration_ms: 1000,
  fps: 10,
  frame_count: 10,
  width: 1000,
  height: 500,
  codec: "h264",
  playback_path: null,
  playback_codec: null,
  playback_error: null,
  poster_frame_path: null,
  probe_error: null,
  poster_error: null,
  frame_timetable_frame_count: null,
  frame_timetable_error: null,
});

function setRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 40,
    right: 1000,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function pointerMove(clientX: number) {
  const event = new Event("pointermove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  return event;
}

function pointerDown(clientX: number, shiftKey = false) {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "shiftKey", { value: shiftKey });
  return event;
}

function pointerUp(clientX: number) {
  const event = new Event("pointerup", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function renderOverlay(extra: Partial<ComponentProps<typeof VideoPlaybackOverlay>> = {}) {
  return render(
    <VideoPlaybackOverlay
      frameIndex={0}
      maxFrame={9}
      timebase={timebase}
      isPlaying={false}
      currentFrameEntryCount={0}
      visible
      onSeek={() => {}}
      onSeekByFrames={() => {}}
      onTogglePlay={() => {}}
      {...extra}
    />,
  );
}

describe("VideoPlaybackOverlay", () => {
  it("renders the active jog playback rate when provided", () => {
    const { getByTestId } = renderOverlay({ isPlaying: true, playbackRateLabel: "-2x" });

    expect(getByTestId("video-playback-rate")).toHaveTextContent("-2x");
  });

  it("starts collapsed and expands into the detailed timeline panel on demand", () => {
    const { getByTestId, getByText, queryByText } = renderOverlay();

    expect(getByTestId("video-timeline-expand")).toBeInTheDocument();
    expect(queryByText("AI 预测密度")).toBeNull();

    fireEvent.click(getByTestId("video-timeline-expand"));

    expect(getByTestId("video-timeline-collapse")).toBeInTheDocument();
    expect(getByText("AI 预测密度")).toBeInTheDocument();
    expect(getByText("标注密度")).toBeInTheDocument();
    expect(getByText("AI 传播")).toBeInTheDocument();
    expect(getByText("Loop 区域")).toBeInTheDocument();
    expect(getByTestId("video-timeline-navigator")).toBeInTheDocument();
    expect(getByTestId("video-timeline-window-readout")).toHaveTextContent("窗口 F0–9");
  });

  it("keeps manual and prediction density visible when a track is selected", () => {
    const selectedTrackTimeline: VideoTrackTimeline = {
      trackId: "trk",
      keyframes: [{ frame: 0, source: "manual", occluded: false }],
      outside: [],
      interpolated: [],
    };
    const { getByTestId } = renderOverlay({
      selectedTrackTimeline,
      globalTimelineDensity: [{ index: 0, from: 0, to: 0, density: 1, tracks: [] }],
      predictionDensity: [{ index: 1, from: 1, to: 1, count: 1 }],
    });

    fireEvent.click(getByTestId("video-timeline-expand"));

    expect(getByTestId("video-timeline-density").querySelector("span")).toBeInTheDocument();
    expect(getByTestId("video-timeline-prediction-density").querySelector("span")).toBeInTheDocument();
    expect(getByTestId("video-track-timeline")).toBeInTheDocument();
  });

  it("keeps sampling grid markers away from timeline edges", () => {
    const { queryAllByTestId } = renderOverlay({ maxFrame: 9, samplingStep: 3 });

    expect(queryAllByTestId("video-timeline-grid-tick")).toHaveLength(2);
  });

  it("hides the off-grid helper marker during playback", () => {
    const playing = renderOverlay({ frameIndex: 1, samplingStep: 3, isPlaying: true });

    expect(playing.queryByTestId("video-timeline-offgrid-marker")).toBeNull();
    playing.unmount();

    const paused = renderOverlay({ frameIndex: 1, samplingStep: 3, isPlaying: false });

    expect(paused.getByTestId("video-timeline-offgrid-marker")).toBeInTheDocument();
  });

  it("reports hover frame changes and renders ready frame previews", () => {
    const onHoverFrameChange = vi.fn();
    const { getByLabelText, getByTestId } = renderOverlay({
      hoverPreview: {
        frameIndex: 5,
        status: "ready",
        url: "/frame-5.webp",
        width: 320,
        format: "webp",
        error: null,
      },
      onHoverFrameChange,
    });
    getByLabelText("视频帧时间轴");
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    fireEvent(shell, pointerMove(560));

    expect(onHoverFrameChange).toHaveBeenCalledWith(5);
    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("F 5");
    expect(getByTestId("video-frame-preview-image")).toHaveAttribute("src", "/frame-5.webp");
  });

  it("does not report duplicate hover changes for the same frame", () => {
    const onHoverFrameChange = vi.fn();
    const { getByTestId } = renderOverlay({ onHoverFrameChange });
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    fireEvent(shell, pointerMove(560));
    fireEvent(shell, pointerMove(561));

    expect(onHoverFrameChange).toHaveBeenCalledTimes(1);
    expect(onHoverFrameChange).toHaveBeenCalledWith(5);
  });

  it("seeks from the timeline shell instead of relying on native range pointer focus", () => {
    const onSeek = vi.fn();
    const { getByTestId } = renderOverlay({ onSeek });
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    fireEvent(shell, pointerDown(560));

    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it("renders pending and error preview fallbacks without hiding frame context", () => {
    const { getByLabelText, getByTestId, rerender } = renderOverlay({
      hoverPreview: {
        frameIndex: 4,
        status: "pending",
        url: null,
        width: 320,
        format: "webp",
        error: null,
      },
    });
    getByLabelText("视频帧时间轴");
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    fireEvent(shell, pointerMove(440));

    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("Loading F 4");

    rerender(
      <VideoPlaybackOverlay
        frameIndex={0}
        maxFrame={9}
        timebase={timebase}
        isPlaying={false}
        currentFrameEntryCount={0}
        visible
        hoverPreview={{
          frameIndex: 4,
          status: "error",
          url: null,
          width: 320,
          format: "webp",
          error: "failed",
        }}
        onSeek={() => {}}
        onSeekByFrames={() => {}}
        onTogglePlay={() => {}}
      />,
    );

    fireEvent(shell, pointerMove(440));

    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("Preview unavailable");
    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("F 4");
  });

  it("uses overlay frame stepping for range arrow keys", () => {
    const onSeekByFrames = vi.fn();
    const { getByLabelText } = renderOverlay({ onSeekByFrames });
    const range = getByLabelText("视频帧时间轴");

    const dispatched = fireEvent.keyDown(range, { key: "ArrowRight" });
    fireEvent.keyDown(range, { key: "ArrowLeft", shiftKey: true });

    expect(dispatched).toBe(false);
    expect(onSeekByFrames).toHaveBeenNthCalledWith(1, 1);
    expect(onSeekByFrames).toHaveBeenNthCalledWith(2, -10);
  });

  it("uses configured large frame step for Shift + range arrow keys", () => {
    const onSeekByFrames = vi.fn();
    const { getByLabelText } = renderOverlay({
      largeFrameStep: "grid",
      samplingStep: 5,
      onSeekByFrames,
    });
    const range = getByLabelText("视频帧时间轴");

    fireEvent.keyDown(range, { key: "ArrowRight", shiftKey: true });

    expect(onSeekByFrames).toHaveBeenCalledWith(5);
  });

  it("moves keyboard focus from the range to the timeline shell after pointer interaction", () => {
    const { getByLabelText, getByTestId } = renderOverlay();
    const shell = getByTestId("video-timeline-shell") as HTMLDivElement;
    const range = getByLabelText("视频帧时间轴") as HTMLInputElement;
    const focus = vi.spyOn(shell, "focus");
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    fireEvent.focus(range);
    fireEvent.pointerUp(range);

    expect(shell.tabIndex).toBe(0);
    expect(range.tabIndex).toBe(-1);
    expect(focus).toHaveBeenCalledTimes(2);
    raf.mockRestore();
  });

  it("captures arrow keys when the timeline shell owns focus", () => {
    const onSeekByFrames = vi.fn();
    const { getByTestId } = renderOverlay({ onSeekByFrames });
    const shell = getByTestId("video-timeline-shell") as HTMLDivElement;

    shell.focus();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });

    expect(onSeekByFrames).toHaveBeenNthCalledWith(1, 1);
    expect(onSeekByFrames).toHaveBeenNthCalledWith(2, -10);
  });

  // v0.21.13 · 区间选择基建: 默认 purpose="loop" 时 Shift+拖仍提交循环区间 (零回归)。
  it("commits a loop region on Shift+drag by default (range-select purpose loop)", () => {
    const onLoopRegionChange = vi.fn();
    const onRangeSelect = vi.fn();
    const { getByTestId } = renderOverlay({ onLoopRegionChange, onRangeSelect });
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    fireEvent(shell, pointerDown(100, true));
    expect(getByTestId("video-loop-region-preview")).toBeInTheDocument();
    fireEvent(shell, pointerMove(600));
    fireEvent(shell, pointerUp(600));

    expect(onLoopRegionChange).toHaveBeenCalledWith({ startFrame: 1, endFrame: 5 });
    expect(onRangeSelect).not.toHaveBeenCalled();
  });

  // v0.21.13 · 区间选择基建: purpose="chapter-draft" 时 Shift+拖走通用 onRangeSelect, 草稿带用章节样式。
  it("routes a chapter-draft brush to onRangeSelect with the purpose tag", () => {
    const onLoopRegionChange = vi.fn();
    const onRangeSelect = vi.fn();
    const { getByTestId } = renderOverlay({
      rangeSelectPurpose: "chapter-draft",
      onLoopRegionChange,
      onRangeSelect,
    });
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    fireEvent(shell, pointerDown(200, true));
    expect(getByTestId("video-timeline-chapter-draft")).toBeInTheDocument();
    fireEvent(shell, pointerMove(900));
    fireEvent(shell, pointerUp(900));

    expect(onRangeSelect).toHaveBeenCalledWith("chapter-draft", { startFrame: 2, endFrame: 8 });
    expect(onLoopRegionChange).not.toHaveBeenCalled();
  });

  // v0.21.14 · propagate-range 用途保留普通拖 seek, 仅 Shift+拖才圈选 (对话框开着仍能 scrub 预览)。
  it("keeps plain-drag seek under propagate-range purpose; only Shift+drag brushes", () => {
    const onSeek = vi.fn();
    const onRangeSelect = vi.fn();
    const { getByTestId } = renderOverlay({
      rangeSelectPurpose: "propagate-range",
      onSeek,
      onRangeSelect,
    });
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);

    // 普通拖 → seek, 不圈选。
    fireEvent(shell, pointerDown(300));
    expect(onSeek).toHaveBeenCalledWith(3);
    expect(onRangeSelect).not.toHaveBeenCalled();
    fireEvent(shell, pointerUp(300));

    // Shift+拖 → 圈选 propagate-range。
    fireEvent(shell, pointerDown(200, true));
    fireEvent(shell, pointerMove(800));
    fireEvent(shell, pointerUp(800));
    expect(onRangeSelect).toHaveBeenCalledWith("propagate-range", { startFrame: 2, endFrame: 7 });
  });

  // v0.21.13 WS3 · 拖章节条右边界 → 松手 onChapterResize 落新起止帧 (拖动中本地预览)。
  it("resizes a chapter by dragging its end handle and commits on pointer up", () => {
    const onChapterResize = vi.fn();
    const { getByTestId } = renderOverlay({
      chapters: [{ id: "ch1", startFrame: 1, endFrame: 5, title: "A", color: null }],
      onChapterResize,
    });
    const shell = getByTestId("video-timeline-shell");
    setRect(shell);
    const endHandle = getByTestId("video-chapter-resize-end");

    fireEvent(endHandle, pointerDown(500));
    fireEvent(endHandle, pointerMove(900));
    // 拖动中不落库, 仅预览。
    expect(onChapterResize).not.toHaveBeenCalled();
    fireEvent(endHandle, pointerUp(900));

    expect(onChapterResize).toHaveBeenCalledWith("ch1", { startFrame: 1, endFrame: 8 });
  });

  it("does not render resize handles without an onChapterResize handler", () => {
    const { queryByTestId } = renderOverlay({
      chapters: [{ id: "ch1", startFrame: 1, endFrame: 5, title: "A", color: null }],
    });
    expect(queryByTestId("video-chapter-resize-end")).toBeNull();
  });

  // v0.21.14 WS3 · AI 传播对话框打开时在时间轴受控高亮影响范围。
  it("renders the propagate range highlight when provided", () => {
    const { getByTestId, queryByTestId, rerender } = renderOverlay();
    expect(queryByTestId("video-propagate-range")).toBeNull();
    rerender(
      <VideoPlaybackOverlay
        frameIndex={0}
        maxFrame={9}
        timebase={timebase}
        isPlaying={false}
        currentFrameEntryCount={0}
        visible
        propagateRange={{ startFrame: 2, endFrame: 7 }}
        onSeek={() => {}}
        onSeekByFrames={() => {}}
        onTogglePlay={() => {}}
      />,
    );
    const band = getByTestId("video-propagate-range");
    expect(band.style.getPropertyValue("--timeline-left")).toBe(`${(2 / 9) * 100}%`);
  });

  // v0.21.13 WS4 · 时间轴章节条 hover 上报 + 受控高亮 (与侧栏行双向联动)。
  it("reports chapter hover and reflects the controlled hovered chapter", () => {
    const onHoverChapter = vi.fn();
    const { getByTestId, rerender } = renderOverlay({
      chapters: [{ id: "ch1", startFrame: 1, endFrame: 5, title: "A", color: null }],
      onHoverChapter,
    });
    const bar = getByTestId("video-timeline-chapter");
    fireEvent.pointerEnter(bar);
    expect(onHoverChapter).toHaveBeenCalledWith("ch1");
    fireEvent.pointerLeave(bar);
    expect(onHoverChapter).toHaveBeenCalledWith(null);

    rerender(
      <VideoPlaybackOverlay
        frameIndex={0}
        maxFrame={9}
        timebase={timebase}
        isPlaying={false}
        currentFrameEntryCount={0}
        visible
        chapters={[{ id: "ch1", startFrame: 1, endFrame: 5, title: "A", color: null }]}
        hoveredChapterId="ch1"
        onSeek={() => {}}
        onSeekByFrames={() => {}}
        onTogglePlay={() => {}}
      />,
    );
    expect(getByTestId("video-timeline-chapter")).toHaveAttribute("data-hovered", "true");
  });

  // 回归: 人工关键帧密度与 AI 候选密度必须共用同一计数基准, 柱高才真实反映数量占比。
  // 修复前两条 lane 各自独立归一化, 会把「1 个关键帧」画得比「8 个候选」还高 (倒挂)。
  it("scales manual and prediction density on a shared count basis so bar height reflects real ratio", () => {
    const px = (el: HTMLElement) => parseFloat(el.style.getPropertyValue("--density-height"));
    const { getByTestId } = renderOverlay({
      globalTimelineDensity: [{ index: 0, from: 0, to: 0, density: 1, tracks: [] }],
      predictionDensity: [{ index: 0, from: 0, to: 0, count: 8 }],
    });

    const manualBin = getByTestId("video-timeline-density").querySelector("span") as HTMLElement;
    const predBin = getByTestId("video-timeline-prediction-density").querySelector("span") as HTMLElement;

    // 8 个候选的柱必须显著高于 1 个关键帧的柱 (共享 max=8 下: 9px vs 2px), 不再倒挂。
    expect(px(predBin)).toBeGreaterThan(px(manualBin));
    expect(px(predBin)).toBeGreaterThan(px(manualBin) * 3);
  });
});

describe("densityBinGradient", () => {
  const bin = (
    density: number,
    tracks: VideoTimelineDensityBin["tracks"],
  ): VideoTimelineDensityBin => ({ index: 0, from: 0, to: 1, density, tracks });

  it("fills with accent when bin has density but no track ownership (legacy bbox)", () => {
    const gradient = densityBinGradient(bin(3, []));

    expect(gradient).toMatch(/^linear-gradient\(to top, /);
    // 没有任何 track 段, 只有 accent 兜底覆盖 0%~100%
    const stops = gradient.match(/color-mix\([^)]+\)/g) ?? [];
    expect(stops).toHaveLength(2);
    expect(stops[0]).toContain("var(--sc-brand)");
    expect(gradient).toContain("0.00%");
    expect(gradient).toContain("100%");
  });

  it("tops up the remainder with accent when tracks cover only part of the density", () => {
    // density=4, 但只有 2 个 track keyframe (差额 2 是 legacy bbox)
    const gradient = densityBinGradient(bin(4, [{ trackId: "t1", count: 2 }]));

    expect(gradient).toContain(densityHelpers.color("t1"));
    expect(gradient).toContain("var(--sc-brand)");
    // t1 占 0%~50%, accent 占 50%~100%
    expect(gradient).toContain("0.00%");
    expect(gradient).toContain("50.00%");
    expect(gradient).toContain("100%");
  });

  it("respects overrides when provided", () => {
    const overrides = { t1: "oklch(0.7 0.2 200)" };
    const gradient = densityBinGradient(bin(2, [{ trackId: "t1", count: 2 }]), overrides);

    expect(gradient).toContain("oklch(0.7 0.2 200)");
    // 完全覆盖时不应出现 accent 兜底
    expect(gradient).not.toContain("var(--sc-brand)");
  });

  it("stacks tracks in iteration order (stable for same-count tracks)", () => {
    // 两个轨迹同 count, 按传入顺序堆叠 (Map 插入序 + 稳定 sort)
    const gradient = densityBinGradient(
      bin(4, [
        { trackId: "tA", count: 2 },
        { trackId: "tB", count: 2 },
      ]),
    );

    const colorA = densityHelpers.color("tA");
    const colorB = densityHelpers.color("tB");
    // tA 应排在 tB 前 (自底向上: tA 从 0% 开始)
    const idxA = gradient.indexOf(colorA);
    const idxB = gradient.indexOf(colorB);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
    // 边界: 0% → 50% (tA) → 100% (tB); 全覆盖时尾部 stop 是 pct(total) = "100.00%"
    expect(gradient).toContain("0.00%");
    expect(gradient).toContain("50.00%");
    expect(gradient).toContain("100.00%");
  });
});

describe("resolveLargeFrameStep", () => {
  it("resolves grid to sampling step, falling back to 10 without sampling grid", () => {
    expect(resolveLargeFrameStep("grid", 5)).toBe(5);
    expect(resolveLargeFrameStep("grid", 1)).toBe(10);
    expect(resolveLargeFrameStep(30, 5)).toBe(30);
  });
});

const densityHelpers = {
  color: (trackId: string) => getTrackColor(trackId, ""),
};
