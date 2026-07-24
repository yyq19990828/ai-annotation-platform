// v0.6.4 · useWorkbenchAnnotationActions smoke 测试。
//
// 现有测试基线没有 @testing-library/react，因此完整 renderHook 单测留作后续 P2。
// 这里只做：模块导出存在 + 类型签名稳定（构造 args 不报 TS 错）。

import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkbenchAnnotationActions } from "./useWorkbenchAnnotationActions";

describe("useWorkbenchAnnotationActions module", () => {
  it("exports the hook", () => {
    expect(typeof useWorkbenchAnnotationActions).toBe("function");
  });

  it("多边形和旋转框完成后先选类，不直接使用推荐类别", () => {
    const create = vi.fn();
    const state = {
      tool: "polygon",
      activeClass: "Recommended",
      pendingDrawing: null as import("./useWorkbenchState").PendingDrawing,
      setPendingDrawing: vi.fn((pending: import("./useWorkbenchState").PendingDrawing) => {
        state.pendingDrawing = pending;
      }),
      setActiveClass: vi.fn(),
      setSelectedId: vi.fn(),
    };
    const { result } = renderHook(() =>
      useWorkbenchAnnotationActions({
        taskId: "task-1",
        projectId: "project-1",
        meUserId: "user-1",
        queryClient: new QueryClient(),
        history: { push: vi.fn() } as never,
        s: state as never,
        pushToast: vi.fn(),
        recordRecentClass: vi.fn(),
        mutations: {
          create: { mutate: create },
          update: { mutate: vi.fn() },
          delete: { mutate: vi.fn() },
        },
        enqueueOnError: vi.fn(),
        annotationsRef: { current: [] },
        activeToolHasOwnClasses: true,
      }),
    );
    const points: [number, number][] = [
      [0.1, 0.2],
      [0.5, 0.2],
      [0.3, 0.6],
    ];

    act(() => result.current.submitPolygon(points));
    expect(create).not.toHaveBeenCalled();
    expect(state.pendingDrawing).toMatchObject({ kind: "polygon", points });

    act(() => result.current.handlePickPendingClass("Road"));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation_type: "polygon",
        tool_unit_id: "region",
        class_name: "Road",
      }),
      expect.anything(),
    );

    state.tool = "rotated-box";
    act(() => result.current.createRotatedBbox({ x: 0.2, y: 0.2, w: 0.3, h: 0.2 }));
    expect(state.pendingDrawing).toMatchObject({ kind: "rotated_bbox" });
  });
});
