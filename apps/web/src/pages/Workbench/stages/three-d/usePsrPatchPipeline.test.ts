// v0.16.x 第 3 批 · usePsrPatchPipeline 防抖落库管线单测(B 类里少见可单测者):
// fake timers 锁定 250ms 防抖 / 校验门槛 / box_3d 才入 history / selectedId 守卫。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePsrPatchPipeline } from "./usePsrPatchPipeline";
import type { useUpdateAnnotation } from "@/hooks/useTasks";
import type { useThreeDHistory } from "./useThreeDHistory";
import type { AnnotationResponse } from "@/types";
import type { PsrField } from "./ThreeDWorkbench.helpers";

const VALID: Record<PsrField, string> = {
  cx: "1", cy: "2", cz: "3", l: "4", w: "5", h: "6", yaw: "0", pitch: "0", roll: "0",
};
const INVALID: Record<PsrField, string> = { ...VALID, h: "0" }; // 尺寸 0 → 非法

function boxAnn(): AnnotationResponse {
  return {
    id: "a1",
    geometry: { type: "box_3d", center: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] },
  } as unknown as AnnotationResponse;
}

function mocks() {
  const update = { mutate: vi.fn() } as unknown as ReturnType<typeof useUpdateAnnotation>;
  const history = { push: vi.fn() } as unknown as ReturnType<typeof useThreeDHistory>;
  return { update, history };
}

function setup(overrides: Partial<Parameters<typeof usePsrPatchPipeline>[0]> = {}) {
  const { update, history } = mocks();
  const props = {
    selectedId: "a1" as string | null,
    selectedAnn: boxAnn(),
    axisConvention: "iso_8855" as const,
    updateAnnotation: update,
    history,
    ...overrides,
  };
  const { result } = renderHook(() => usePsrPatchPipeline(props));
  return { result, update, history };
}

describe("usePsrPatchPipeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("有效表单 250ms 后 PATCH 并入 history(box_3d)", () => {
    const { result, update, history } = setup();
    act(() => result.current.schedulePatch(VALID));
    expect(update.mutate).not.toHaveBeenCalled(); // 防抖未到
    act(() => vi.advanceTimersByTime(250));
    expect(update.mutate).toHaveBeenCalledTimes(1);
    expect(update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ annotationId: "a1", payload: expect.objectContaining({ geometry: expect.anything() }) }),
    );
    expect(history.push).toHaveBeenCalledTimes(1);
  });

  it("非法表单(尺寸 0)不提交", () => {
    const { result, update } = setup();
    act(() => result.current.schedulePatch(INVALID));
    act(() => vi.advanceTimersByTime(250));
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it("连续调用只触发最后一次(250ms 防抖)", () => {
    const { result, update } = setup();
    act(() => {
      result.current.schedulePatch(VALID);
      result.current.schedulePatch({ ...VALID, cx: "9" });
    });
    act(() => vi.advanceTimersByTime(250));
    expect(update.mutate).toHaveBeenCalledTimes(1);
  });

  it("无 selectedId 时为 no-op", () => {
    const { result, update } = setup({ selectedId: null });
    act(() => result.current.schedulePatch(VALID));
    act(() => vi.advanceTimersByTime(250));
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it("非 box_3d 几何仍 PATCH 但不入 history", () => {
    const ann = { id: "a1", geometry: { type: "point_mask_3d", point_indices: [] } } as unknown as AnnotationResponse;
    const { result, update, history } = setup({ selectedAnn: ann });
    act(() => result.current.schedulePatch(VALID));
    act(() => vi.advanceTimersByTime(250));
    expect(update.mutate).toHaveBeenCalledTimes(1);
    expect(history.push).not.toHaveBeenCalled();
  });
});
