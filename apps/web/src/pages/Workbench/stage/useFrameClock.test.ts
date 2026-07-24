import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFrameClock } from "./useFrameClock";

describe("useFrameClock", () => {
  it("新的大跨度 seek 进行中忽略上一次媒体事件，不回滚已提交目标帧", async () => {
    const video = document.createElement("video");
    const videoRef = { current: video };
    const onFrameChange = vi.fn();
    const { result } = renderHook(() =>
      useFrameClock({
        videoRef,
        frameIndex: 0,
        timebase: {
          fps: 30,
          frameCount: 100,
          source: "estimated",
          ptsMs: null,
          durationMs: 3_333,
        },
        isPlaying: false,
        onFrameChange,
      }),
    );

    act(() => {
      result.current.seekTo(10);
    });
    expect(onFrameChange).toHaveBeenLastCalledWith(10);

    act(() => {
      video.currentTime = 47 / 30;
      fireEvent.timeUpdate(video);
    });
    expect(onFrameChange).toHaveBeenLastCalledWith(10);
    await waitFor(() => expect(result.current.diagnostics.staleCallbacks).toBe(1));

    act(() => {
      video.currentTime = 10 / 30;
      fireEvent.seeked(video);
    });
    expect(onFrameChange).toHaveBeenLastCalledWith(10);
    await waitFor(() => expect(result.current.isSeeking).toBe(false));
  });
});
