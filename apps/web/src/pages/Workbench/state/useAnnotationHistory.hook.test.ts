/**
 * v0.8.3 · useAnnotationHistory hook 集成单测：push / undo / redo / pushBatch /
 * replaceAnnotationId / 切任务清栈。
 *
 * 已有 useAnnotationHistory.test.ts 测的是纯函数 applyLeaf；此处补 React hook
 * 状态机层（栈管理 / busy 锁 / taskId 切换）。
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useAnnotationHistory,
  type Command,
  type HistoryHandlers,
} from "./useAnnotationHistory";

function makeHandlers(): HistoryHandlers {
  return {
    createAnnotation: vi.fn(async (_p) => ({ id: "real-id" }) as any),
    deleteAnnotation: vi.fn(async () => undefined),
    updateAnnotation: vi.fn(async () => undefined),
    removeLocalCreate: vi.fn(async () => undefined),
  };
}

describe("useAnnotationHistory · 栈状态机", () => {
  it("初始 canUndo / canRedo 全 false", () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("push 一条 → canUndo true，canRedo false", () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    const cmd: Command = {
      kind: "update",
      annotationId: "a1",
      before: { class_name: "old" } as any,
      after: { class_name: "new" } as any,
    };
    act(() => result.current.push(cmd));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo → canRedo true；redo → canUndo true", async () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    const cmd: Command = {
      kind: "update",
      annotationId: "a1",
      before: { class_name: "old" } as any,
      after: { class_name: "new" } as any,
    };
    act(() => result.current.push(cmd));

    await act(async () => {
      await result.current.undo();
    });
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(handlers.updateAnnotation).toHaveBeenCalledWith("a1", { class_name: "old" });

    await act(async () => {
      await result.current.redo();
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(handlers.updateAnnotation).toHaveBeenCalledWith("a1", { class_name: "new" });
  });

  it("新 push 清空 redo 栈", async () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    const cmd1: Command = {
      kind: "update",
      annotationId: "a1",
      before: { class_name: "x" } as any,
      after: { class_name: "y" } as any,
    };
    act(() => result.current.push(cmd1));
    await act(async () => {
      await result.current.undo();
    });
    await waitFor(() => expect(result.current.canRedo).toBe(true));

    // push 新命令 → redo 栈应清空
    act(() =>
      result.current.push({
        kind: "update",
        annotationId: "a2",
        before: { class_name: "p" } as any,
        after: { class_name: "q" } as any,
      } as Command),
    );
    expect(result.current.canRedo).toBe(false);
  });

  it("pushBatch · 单条 → 不裹 batch", () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    act(() =>
      result.current.pushBatch([
        {
          kind: "delete",
          annotation: {
            id: "d1",
            annotation_type: "bbox",
            class_name: "c",
            geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 },
          } as any,
        },
      ]),
    );
    expect(result.current.canUndo).toBe(true);
  });

  it("pushBatch · 0 条 → 不入栈", () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    act(() => result.current.pushBatch([]));
    expect(result.current.canUndo).toBe(false);
  });

  it("切任务 → 清栈", async () => {
    const handlers = makeHandlers();
    const { result, rerender } = renderHook(
      ({ taskId }) => useAnnotationHistory(taskId, handlers),
      { initialProps: { taskId: "t1" } },
    );
    act(() =>
      result.current.push({
        kind: "update",
        annotationId: "a",
        before: { class_name: "x" } as any,
        after: { class_name: "y" } as any,
      } as Command),
    );
    expect(result.current.canUndo).toBe(true);

    rerender({ taskId: "t2" });
    expect(result.current.canUndo).toBe(false);
  });

  it("replaceAnnotationId 同步换栈中 tmpId", async () => {
    const handlers = makeHandlers();
    const { result } = renderHook(() => useAnnotationHistory("t1", handlers));
    act(() =>
      result.current.push({
        kind: "create",
        annotationId: "tmp_xyz",
        payload: { class_name: "c", annotation_type: "bbox", geometry: {} as any },
      }),
    );
    act(() => result.current.replaceAnnotationId("tmp_xyz", "real-1"));
    // undo 应触发 deleteAnnotation("real-1")（不再是 tmp_xyz）
    await act(async () => {
      await result.current.undo();
    });
    await waitFor(() => expect(handlers.deleteAnnotation).toHaveBeenCalledWith("real-1"));
  });
});
