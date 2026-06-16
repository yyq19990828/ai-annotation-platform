/**
 * v0.16.1 · 视频底图层(VideoKonvaMediaLayer)测试。
 *
 * 两层分工(对齐 ADR-0041 决策 C):
 *   - 纯函数 pickMediaImageSource:播放/暂停下的 image source 选取矩阵;
 *   - konva mock:断言渲染出 media-bg Layer + Konva.Image,几何 props(world 尺寸)透传。
 * 真实 canvas blit / 播放重绘回归交给 Playwright,不在此验证。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { VideoKonvaMediaLayer, pickMediaImageSource } from "./VideoKonvaMediaLayer";

describe("pickMediaImageSource", () => {
  const video = { tagName: "VIDEO" } as unknown as HTMLVideoElement;
  const bitmap = { width: 1920, height: 1080 } as unknown as ImageBitmap;

  it("播放态用 <video> 实时帧(忽略 bitmap)", () => {
    expect(pickMediaImageSource(true, video, bitmap)).toBe(video);
  });

  it("暂停态优先精确 bitmap", () => {
    expect(pickMediaImageSource(false, video, bitmap)).toBe(bitmap);
  });

  it("暂停态无 bitmap → 回退 <video>", () => {
    expect(pickMediaImageSource(false, video, null)).toBe(video);
  });

  it("无任何源 → undefined(不渲染 Image)", () => {
    expect(pickMediaImageSource(false, null, null)).toBeUndefined();
    expect(pickMediaImageSource(true, null, bitmap)).toBeUndefined();
  });
});

describe("VideoKonvaMediaLayer · konva mock", () => {
  const size = { w: 1920, h: 1080 };
  const bitmap = { width: 1920, height: 1080 } as unknown as ImageBitmap;

  it("渲染 media-bg Layer + Konva.Image,world 尺寸按 size 透传", () => {
    render(
      <VideoKonvaMediaLayer videoEl={null} bitmap={bitmap} size={size} isPlaybackActive={false} />,
    );
    const layer = document.querySelector('[data-konva="Layer"]');
    expect(layer?.getAttribute("data-testid")).toBe("media-bg");
    const image = document.querySelector('[data-konva="Image"]');
    expect(image).not.toBeNull();
    expect(image!.getAttribute("data-width")).toBe("1920");
    expect(image!.getAttribute("data-height")).toBe("1080");
    // 底图层不参与 hit-test。
    expect(image!.getAttribute("data-listening")).toBe("false");
  });

  it("无可画源时只渲染空 Layer,不渲染 Image", () => {
    render(
      <VideoKonvaMediaLayer videoEl={null} bitmap={null} size={size} isPlaybackActive={false} />,
    );
    expect(document.querySelector('[data-konva="Layer"]')).not.toBeNull();
    expect(document.querySelector('[data-konva="Image"]')).toBeNull();
  });
});
