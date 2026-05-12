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

function renderOverlay(extra: Partial<ComponentProps<typeof VideoPlaybackOverlay>> = {}) {
  return render(
    <VideoPlaybackOverlay
      frameIndex={0}
      maxFrame={9}
      timebase={timebase}
      isPlaying={false}
      annotatedFrames={[]}
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
    const range = getByLabelText("视频帧时间轴");
    setRect(range);

    fireEvent(range, pointerMove(560));

    expect(onHoverFrameChange).toHaveBeenCalledWith(5);
    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("F 5");
    expect(getByTestId("video-frame-preview-image")).toHaveAttribute("src", "/frame-5.webp");
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
    const range = getByLabelText("视频帧时间轴");
    setRect(range);

    fireEvent(range, pointerMove(440));

    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("Loading F 4");

    rerender(
      <VideoPlaybackOverlay
        frameIndex={0}
        maxFrame={9}
        timebase={timebase}
        isPlaying={false}
        annotatedFrames={[]}
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

    fireEvent(getByLabelText("视频帧时间轴"), pointerMove(440));

    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("Preview unavailable");
    expect(getByTestId("video-frame-preview-popover")).toHaveTextContent("F 4");
  });
});
