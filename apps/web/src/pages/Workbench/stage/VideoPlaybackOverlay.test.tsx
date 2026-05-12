import { fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";
import { buildFrameTimebase } from "./frameTimebase";

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
