import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiParamPresets } from "./useAiParamPresets";

describe("useAiParamPresets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("save 写入并 read 回 (variant + params 快照)", () => {
    const { result } = renderHook(() => useAiParamPresets("b1", "text"));
    act(() => {
      result.current.save("高精度", { series: "yolov8", size: "m", conf: 0.5 });
    });
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe("高精度");
    expect(result.current.presets[0].values).toEqual({
      series: "yolov8",
      size: "m",
      conf: 0.5,
    });
  });

  it("同名 save 覆盖而非追加", () => {
    const { result } = renderHook(() => useAiParamPresets("b1", "text"));
    act(() => {
      result.current.save("档", { conf: 0.2 });
    });
    act(() => {
      result.current.save("档", { conf: 0.8 });
    });
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].values).toEqual({ conf: 0.8 });
  });

  it("remove 删除指定预设", () => {
    const { result } = renderHook(() => useAiParamPresets("b1", "text"));
    act(() => {
      result.current.save("a", { conf: 0.1 });
    });
    act(() => {
      result.current.save("b", { conf: 0.2 });
    });
    const idA = result.current.presets.find((p) => p.name === "a")!.id;
    act(() => {
      result.current.remove(idA);
    });
    expect(result.current.presets.map((p) => p.name)).toEqual(["b"]);
  });

  it("按 (backend, task) 分桶隔离, 不串台", () => {
    const { result: r1 } = renderHook(() => useAiParamPresets("b1", "text"));
    act(() => {
      r1.current.save("p", { conf: 0.3 });
    });
    const { result: r2 } = renderHook(() => useAiParamPresets("b2", "text"));
    expect(r2.current.presets).toHaveLength(0);
    const { result: r3 } = renderHook(() => useAiParamPresets("b1", "ocr"));
    expect(r3.current.presets).toHaveLength(0);
  });

  it("空名不保存", () => {
    const { result } = renderHook(() => useAiParamPresets("b1", "text"));
    act(() => {
      result.current.save("  ", { conf: 0.5 });
    });
    expect(result.current.presets).toHaveLength(0);
  });

  it("无 backendId 时 save 不抛且无预设", () => {
    const { result } = renderHook(() => useAiParamPresets(null, "text"));
    act(() => {
      result.current.save("x", { conf: 0.5 });
    });
    expect(result.current.presets).toHaveLength(0);
  });
});
