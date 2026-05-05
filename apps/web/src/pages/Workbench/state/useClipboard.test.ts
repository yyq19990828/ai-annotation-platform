/**
 * v0.7.6 · useClipboard 单测：覆盖 copy / paste 偏移、polygon 平移、bbox clamp。
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipboard } from "./useClipboard";
import type { Annotation } from "@/types";

function bbox(id: string, over: Partial<Annotation> = {}): Annotation {
  return {
    id,
    cls: "car",
    x: 0.4,
    y: 0.4,
    w: 0.2,
    h: 0.2,
    color: "#fff",
    ...over,
  } as Annotation;
}

function polygonAnn(id: string): Annotation {
  return {
    ...bbox(id),
    polygon: [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
    ],
  } as Annotation;
}

describe("useClipboard", () => {
  it("copy 选中后返回数量并写入 clipboard setter", () => {
    const setClipboard = vi.fn();
    const { result } = renderHook(() =>
      useClipboard({
        userBoxes: [bbox("a"), bbox("b")],
        selectedIds: ["a"],
        clipboard: [],
        setClipboard,
        createAnnotation: vi.fn(),
        pushBatch: vi.fn(),
        imgW: 1000,
        imgH: 1000,
      }),
    );
    let n = 0;
    act(() => {
      n = result.current.copySelection();
    });
    expect(n).toBe(1);
    expect(setClipboard).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "a" })]),
    );
  });

  it("paste bbox 应用 +10px 偏移并 clamp 到 [0, 1-w]", async () => {
    const createAnnotation = vi.fn(async () => ({ id: "new-1" }) as never);
    const pushBatch = vi.fn();
    const { result } = renderHook(() =>
      useClipboard({
        userBoxes: [],
        selectedIds: [],
        clipboard: [bbox("a", { x: 0.95, y: 0.95, w: 0.04, h: 0.04 })],
        setClipboard: vi.fn(),
        createAnnotation,
        pushBatch,
        imgW: 100,
        imgH: 100,
      }),
    );
    await act(async () => {
      await result.current.paste();
    });
    expect(createAnnotation).toHaveBeenCalledTimes(1);
    const payload = (createAnnotation.mock.calls[0] as unknown[])[0] as {
      geometry: { type: string; x?: number; points?: number[][] };
    };
    expect(payload.geometry.type).toBe("bbox");
    // x clamped: 0.95 + 0.1 = 1.05 → cap to 1 - w = 0.96
    expect(payload.geometry.x).toBeCloseTo(0.96, 2);
    expect(pushBatch).toHaveBeenCalledTimes(1);
  });

  it("paste polygon 整体平移", async () => {
    const createAnnotation = vi.fn(async () => ({ id: "new-poly" }) as never);
    const { result } = renderHook(() =>
      useClipboard({
        userBoxes: [],
        selectedIds: [],
        clipboard: [polygonAnn("p")],
        setClipboard: vi.fn(),
        createAnnotation,
        pushBatch: vi.fn(),
        imgW: 100,
        imgH: 100,
      }),
    );
    await act(async () => {
      await result.current.paste();
    });
    const payload = (createAnnotation.mock.calls[0] as unknown[])[0] as {
      geometry: { type: string; x?: number; points?: number[][] };
    };
    expect(payload.geometry.type).toBe("polygon");
    const pts = (payload.geometry as { points: number[][] }).points;
    expect(pts).toHaveLength(3);
    // 第 1 个点 0.1 + 0.1 = 0.2
    expect(pts[0][0]).toBeCloseTo(0.2, 2);
  });

  it("空 clipboard 时 paste 不触发 createAnnotation", async () => {
    const createAnnotation = vi.fn();
    const { result } = renderHook(() =>
      useClipboard({
        userBoxes: [],
        selectedIds: [],
        clipboard: [],
        setClipboard: vi.fn(),
        createAnnotation,
        pushBatch: vi.fn(),
        imgW: 100,
        imgH: 100,
      }),
    );
    await act(async () => {
      await result.current.paste();
    });
    expect(createAnnotation).not.toHaveBeenCalled();
  });
});
