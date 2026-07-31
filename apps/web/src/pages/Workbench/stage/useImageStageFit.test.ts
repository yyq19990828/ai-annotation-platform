import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Viewport } from "../state/useViewportTransform";
import { useImageStageFit } from "./useImageStageFit";

describe("useImageStageFit", () => {
  it("媒体 identity 变化时按新图尺寸重新自适应", () => {
    const setViewport = vi.fn() as React.Dispatch<React.SetStateAction<Viewport>>;
    const { result, rerender } = renderHook(
      (props: { identity: string; width: number; height: number }) =>
        useImageStageFit({
          imageIdentity: props.identity,
          imageWidth: props.width,
          imageHeight: props.height,
          dimsReady: true,
          viewportSize: { w: 1_000, h: 800 },
          setViewport,
          fitTick: 0,
          autoFitOnResize: false,
        }),
      { initialProps: { identity: "task-a", width: 1_000, height: 1_000 } },
    );

    expect(result.current.fitted).toBe(true);
    expect(setViewport).toHaveBeenLastCalledWith({ scale: 0.8, tx: 100, ty: 0 });

    rerender({ identity: "task-b", width: 2_000, height: 500 });

    expect(result.current.fitted).toBe(true);
    expect(setViewport).toHaveBeenLastCalledWith({ scale: 0.5, tx: 0, ty: 275 });
  });

  it("尺寸未就绪时保持隐藏，就绪后再揭开画布", () => {
    const setViewport = vi.fn() as React.Dispatch<React.SetStateAction<Viewport>>;
    const { result, rerender } = renderHook(
      (dimsReady: boolean) =>
        useImageStageFit({
          imageIdentity: "task-a",
          imageWidth: 2_000,
          imageHeight: 1_000,
          dimsReady,
          viewportSize: { w: 1_000, h: 800 },
          setViewport,
          fitTick: 0,
          autoFitOnResize: false,
        }),
      { initialProps: false },
    );

    expect(result.current.fitted).toBe(false);
    expect(setViewport).not.toHaveBeenCalled();

    rerender(true);

    expect(result.current.fitted).toBe(true);
    expect(setViewport).toHaveBeenCalledWith({ scale: 0.5, tx: 0, ty: 150 });
  });
});
