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
import { applyMaskPolygon } from "../stage/shared/geometry/maskOperations";

describe("useMaskEditor · 初始态", () => {
  it("初始非 active，dirty=false，buffer=null，revision=0", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 50, height: 50 }));
    expect(result.current.active).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.buffer).toBeNull();
    expect(result.current.mode).toBe("brush");
    expect(result.current.radius).toBe(MASK_BRUSH_DEFAULT_PX);
    expect(result.current.revision).toBe(0);
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
  it("initFromRle / commitToRle 保持像素合同", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 3, height: 2 }));
    const rle = { encoding: "coco_rle" as const, size: [2, 3] as [number, number], counts: [1, 2, 2, 1] };
    act(() => { result.current.initFromRle(rle); });
    expect(result.current.buffer?.countSet()).toBe(3);
    expect(result.current.commitToRle()).toEqual(rle);
  });

  it("initFromRle 拒绝尺寸不匹配", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 3, height: 2 }));
    expect(() => act(() => {
      result.current.initFromRle({ encoding: "coco_rle", size: [3, 2], counts: [6] });
    })).toThrow(/does not match/);
  });

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
    const revAfterBegin = result.current.revision;
    act(() => { result.current.paintAt(40, 40); });
    expect(result.current.dirty).toBe(true);
    expect(result.current.buffer!.get(40, 40)).toBe(255);
    expect(result.current.buffer!.countSet()).toBeGreaterThan(250);
    // v0.10.8 · revision 在每次 paintAt 后 bump，供 MaskOverlayLayer 触发重画。
    expect(result.current.revision).toBeGreaterThan(revAfterBegin);
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

describe("useMaskEditor · stroke undo / redo", () => {
  it("records one history step for a complete pointer stroke", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 8, height: 8, initialRadius: 1 }));
    act(() => {
      result.current.beginBlank();
      result.current.beginStroke();
      result.current.paintAt(2, 2);
      result.current.paintAt(3, 2);
      result.current.endStroke();
    });
    expect(result.current.canUndo).toBe(true);
    const painted = result.current.buffer?.countSet() ?? 0;
    expect(painted).toBeGreaterThan(0);

    act(() => result.current.undo());
    expect(result.current.buffer?.countSet()).toBe(0);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.buffer?.countSet()).toBe(painted);
  });
});

describe("useMaskEditor · operation preview / command", () => {
  it("preview 不修改 live buffer，confirm 后只产生一个可撤销 command", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 6, height: 4 }));
    act(() => result.current.beginBlank());
    const sourceRevision = result.current.revision;
    const operation = applyMaskPolygon(result.current.buffer!.data, 6, 4, {
      points: [[1, 1], [5, 1], [5, 3], [1, 3]],
      value: 255,
    });

    let accepted = false;
    act(() => {
      accepted = result.current.previewOperation("lasso_add", operation, sourceRevision);
    });
    expect(accepted).toBe(true);
    expect(result.current.buffer?.countSet()).toBe(0);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.operationPreview?.report.afterArea).toBe(8);

    act(() => result.current.confirmOperation());
    expect(result.current.operationPreview).toBeNull();
    expect(result.current.buffer?.countSet()).toBe(8);
    expect(result.current.dirty).toBe(true);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.buffer?.countSet()).toBe(0);
    act(() => result.current.redo());
    expect(result.current.buffer?.countSet()).toBe(8);
  });

  it("cancel preview 不 dirty，旧 revision 的 Worker 结果被拒绝", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 5, height: 5, initialRadius: 1 }));
    act(() => result.current.beginBlank());
    const staleRevision = result.current.revision;
    const stale = applyMaskPolygon(result.current.buffer!.data, 5, 5, {
      points: [[0, 0], [3, 0], [3, 3], [0, 3]],
      value: 255,
    });
    act(() => result.current.paintAt(4, 4));

    let accepted = true;
    act(() => {
      accepted = result.current.previewOperation("stale", stale, staleRevision);
    });
    expect(accepted).toBe(false);
    expect(result.current.operationPreview).toBeNull();

    const current = applyMaskPolygon(result.current.buffer!.data, 5, 5, {
      points: [[0, 0], [2, 0], [2, 2], [0, 2]],
      value: 255,
    });
    act(() => {
      result.current.previewOperation("current", current, result.current.revision);
      result.current.cancelOperation();
    });
    expect(result.current.operationPreview).toBeNull();
    expect(result.current.buffer?.get(4, 4)).toBe(255);
  });

  it("materializeFromRle 明确进入 dirty，不伪造像素笔画", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 3, height: 2 }));
    const rle = {
      encoding: "coco_rle" as const,
      size: [2, 3] as [number, number],
      counts: [1, 2, 2, 1],
    };
    act(() => result.current.materializeFromRle(rle));
    expect(result.current.active).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.commitToRle()).toEqual(rle);
    expect(result.current.canUndo).toBe(false);
  });

  it("高级工具与 brush/erase 兼容 mode 同步", () => {
    const { result } = renderHook(() => useMaskEditor({ width: 3, height: 2 }));
    act(() => result.current.setTool("lasso_add"));
    expect(result.current.tool).toBe("lasso_add");
    expect(result.current.mode).toBe("brush");
    act(() => result.current.setMode("erase"));
    expect(result.current.tool).toBe("erase");
    act(() => result.current.setBrushShape("square"));
    expect(result.current.brushShape).toBe("square");
  });

  it("runOperation 在小图同步计算并进入 preview 状态", async () => {
    const { result } = renderHook(() => useMaskEditor({ width: 4, height: 3 }));
    act(() => result.current.beginBlank());
    await act(async () => {
      expect(await result.current.runOperation("fill_add", {
        type: "flood_fill",
        x: 0,
        y: 0,
        value: 255,
        connectivity: 4,
      })).toBe(true);
    });
    expect(result.current.operationStatus).toBe("preview");
    expect(result.current.operationPreview?.report.afterArea).toBe(12);
    expect(result.current.buffer?.countSet()).toBe(0);
  });
});
