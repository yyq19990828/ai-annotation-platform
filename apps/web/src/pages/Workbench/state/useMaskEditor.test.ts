// v0.10.7.1 · useMaskEditor 单测：
// - 初始非 active；beginBlank / initFromPolygon 后 active
// - paintAt 调 brush / erase 按 mode 分流
// - radius clamp 到 [MIN, MAX]
// - dirty 在 paintAt 后变 true；cancel 后 false
// - commitToPolygon 空 mask 返回 null；有内容时返回外环顶点

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useMaskEditor,
  MASK_BRUSH_MIN_PX,
  MASK_BRUSH_MAX_PX,
  MASK_BRUSH_DEFAULT_PX,
} from "./useMaskEditor";

describe("useMaskEditor · 初始态", () => {
  it("初始非 active，dirty=false，buffer=null", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 50, height: 50 }));
    expect(result.current.active).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.buffer).toBeNull();
    expect(result.current.mode).toBe("brush");
    expect(result.current.radius).toBe(MASK_BRUSH_DEFAULT_PX);
  });

  it("initialRadius clamp 到合法区间", () => {
    const { result: small } = renderHook(() =>
      useMaskEditor({ width: 50, height: 50, initialRadius: -10 }),
    );
    expect(small.current.radius).toBe(MASK_BRUSH_MIN_PX);
    const { result: big } = renderHook(() =>
      useMaskEditor({ width: 50, height: 50, initialRadius: 9999 }),
    );
    expect(big.current.radius).toBe(MASK_BRUSH_MAX_PX);
  });
});

describe("useMaskEditor · beginBlank / initFromPolygon", () => {
  it("beginBlank 进入 active；buffer 全 0", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 30, height: 30 }));
    act(() => { result.current.beginBlank(); });
    expect(result.current.active).toBe(true);
    expect(result.current.buffer).not.toBeNull();
    expect(result.current.buffer!.countSet()).toBe(0);
  });

  it("initFromPolygon 填充矩形 buffer", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 30, height: 30 }));
    act(() => {
      result.current.initFromPolygon([[5, 5], [25, 5], [25, 25], [5, 25]]);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.buffer!.countSet()).toBeGreaterThan(300);
  });
});

describe("useMaskEditor · paintAt / mode / radius", () => {
  it("paintAt brush 模式在 buffer 留下圆形", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 80, height: 80, initialRadius: 10 }));
    act(() => { result.current.beginBlank(); });
    act(() => { result.current.paintAt(40, 40); });
    expect(result.current.dirty).toBe(true);
    expect(result.current.buffer!.get(40, 40)).toBe(255);
    expect(result.current.buffer!.countSet()).toBeGreaterThan(250);
  });

  it("paintAt erase 模式抹掉已画区域", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 80, height: 80, initialRadius: 10 }));
    act(() => { result.current.beginBlank(); });
    act(() => { result.current.paintAt(40, 40); });
    const before = result.current.buffer!.countSet();
    expect(before).toBeGreaterThan(0);
    act(() => { result.current.setMode("erase"); });
    act(() => { result.current.setRadius(12); });
    act(() => { result.current.paintAt(40, 40); });
    expect(result.current.buffer!.countSet()).toBe(0);
  });

  it("paintAt 非 active 时静默", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 30, height: 30 }));
    act(() => { result.current.paintAt(15, 15); });
    expect(result.current.dirty).toBe(false);
    expect(result.current.buffer).toBeNull();
  });

  it("setRadius clamp", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 30, height: 30 }));
    act(() => { result.current.setRadius(-5); });
    expect(result.current.radius).toBe(MASK_BRUSH_MIN_PX);
    act(() => { result.current.setRadius(1e6); });
    expect(result.current.radius).toBe(MASK_BRUSH_MAX_PX);
    act(() => { result.current.setRadius(NaN); });
    // NaN 走 default
    expect(result.current.radius).toBe(MASK_BRUSH_DEFAULT_PX);
  });
});

describe("useMaskEditor · cancel / commitToPolygon", () => {
  it("cancel 清空 buffer 与 active", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 50, height: 50 }));
    act(() => { result.current.beginBlank(); });
    act(() => { result.current.paintAt(25, 25); });
    expect(result.current.dirty).toBe(true);
    act(() => { result.current.cancel(); });
    expect(result.current.active).toBe(false);
    expect(result.current.buffer).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it("commitToPolygon 空 mask 返回 null", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 30, height: 30 }));
    act(() => { result.current.beginBlank(); });
    expect(result.current.commitToPolygon()).toBeNull();
  });

  it("commitToPolygon 有内容时返回外环顶点", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 80, height: 80, initialRadius: 15 }));
    act(() => { result.current.beginBlank(); });
    act(() => { result.current.paintAt(40, 40); });
    const out = result.current.commitToPolygon();
    expect(out).not.toBeNull();
    expect(out!.points.length).toBeGreaterThanOrEqual(3);
    expect(out!.multipleComponents).toBe(false);
  });

  it("commitToPolygon 非 active 时返回 null", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 30, height: 30 }));
    expect(result.current.commitToPolygon()).toBeNull();
  });
});
