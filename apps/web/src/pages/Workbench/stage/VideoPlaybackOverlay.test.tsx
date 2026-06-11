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
import type { VideoTimelineDensityBin } from "./videoTrackTimeline";

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

function pointerDown(clientX: number) {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
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
    expect(stops[0]).toContain("var(--color-accent)");
    expect(gradient).toContain("0.00%");
    expect(gradient).toContain("100%");
  });

  it("tops up the remainder with accent when tracks cover only part of the density", () => {
    // density=4, 但只有 2 个 track keyframe (差额 2 是 legacy bbox)
    const gradient = densityBinGradient(bin(4, [{ trackId: "t1", count: 2 }]));

    expect(gradient).toContain(densityHelpers.color("t1"));
    expect(gradient).toContain("var(--color-accent)");
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
    expect(gradient).not.toContain("var(--color-accent)");
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
