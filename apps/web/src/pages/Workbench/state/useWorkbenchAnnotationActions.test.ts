// Manual creation transactions, durable acceptance, and task ownership regressions.

import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useWorkbenchAnnotationActions } from "./useWorkbenchAnnotationActions";
import type { ContinuousImageCreation } from "./manualImageCreation";
import type { PendingDrawing, Tool } from "./useWorkbenchState";

const { enqueueDurably } = vi.hoisted(() => ({ enqueueDurably: vi.fn(async () => {}) }));
vi.mock("./offlineQueue", () => ({ enqueue: vi.fn(), enqueueDurably }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const bindings = {
  bbox: { enabled: true, classes: [{ name: "car" }], attribute_schema: { fields: [] } },
  region: { enabled: true, classes: [{ name: "car" }], attribute_schema: { fields: [] } },
  rotated_bbox: { enabled: true, classes: [{ name: "car" }], attribute_schema: { fields: [] } },
  polyline: { enabled: true, classes: [{ name: "car" }], attribute_schema: { fields: [] } },
  keypoint: { enabled: true, classes: [{ name: "car" }], attribute_schema: { fields: [] } },
};
const continuous: ContinuousImageCreation = {
  projectId: "project-1",
  tool: "box",
  toolUnitId: "bbox",
  className: "car",
};
const geom = { x: 0.1, y: 0.2, w: 0.3, h: 0.2 };

function setup({
  tool = "box" as Tool,
  intent = continuous as ContinuousImageCreation | null,
  toolBindings = bindings,
  create = vi.fn<(payload: import("@/api/tasks").AnnotationPayload) => Promise<{ id: string }>>(
    async () => ({ id: "created-1" }),
  ),
} = {}) {
  const history = { push: vi.fn() };
  const queryClient = new QueryClient();
  const pushToast = vi.fn();
  const hook = renderHook(
    ({ taskId, locked }) => {
      const [pendingDrawing, setPendingDrawing] = useState<PendingDrawing>(null);
      const [selectedId, setSelectedId] = useState<string | null>(null);
      const state = {
        tool,
        continuousCreation: intent,
        pendingDrawing,
        setPendingDrawing,
        selectedId,
        setSelectedId,
        activeClass: "",
        setActiveClass: vi.fn(),
      };
      const actions = useWorkbenchAnnotationActions({
        taskId,
        projectId: "project-1",
        meUserId: "user-1",
        queryClient,
        history: history as never,
        s: state as never,
        pushToast,
        recordRecentClass: vi.fn(),
        mutations: {
          create: { mutate: vi.fn() },
          update: { mutate: vi.fn() },
          delete: { mutate: vi.fn() },
        },
        createAnnotationAsync: create as never,
        toolBindings: toolBindings as never,
        enqueueOnError: vi.fn(),
        annotationsRef: { current: [] },
        isLocked: locked,
        keypointNodeCount: 2,
      });
      return { ...actions, state };
    },
    { initialProps: { taskId: "task-1", locked: false } },
  );
  return { ...hook, create, history, queryClient, pushToast };
}

describe("useWorkbenchAnnotationActions module", () => {
  it("auto point batches reject undo/cancel/task snapshots and retain the full point budget", () => {
    const hook = setup({ tool: "polygon", intent: null });
    const auto = () => hook.result.current.polygonHandle.autoPoints!;
    const old = auto().getPoints();
    act(() =>
      expect(
        auto().append(
          [
            [0.1, 0.1],
            [0.2, 0.1],
          ],
          old,
        ),
      ).toBe(true),
    );
    act(() => hook.result.current.setPolygonDraftPoints((points) => points.slice(0, -1)));
    act(() => expect(auto().append([[0.3, 0.1]], old)).toBe(false));
    const beforeTask = auto().getPoints();
    hook.rerender({ taskId: "task-2", locked: false });
    act(() => expect(auto().append([[0.3, 0.1]], beforeTask)).toBe(false));
    const many = Array.from({ length: 20_000 }, (_, i): [number, number] => [i / 20_000, 0.2]);
    act(() => expect(auto().append(many, auto().getPoints())).toBe(true));
    act(() => expect(auto().append([[1, 0.2]], auto().getPoints())).toBe(false));
    expect(auto().getPoints()).toEqual(many);
    act(() => hook.result.current.polygonHandle.cancel());
    expect(auto().getPoints()).toEqual([]);
    expect(hook.create).not.toHaveBeenCalled();
    hook.unmount();
    hook.queryClient.clear();
  });
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

    act(() => create.mock.calls[0][1].onSuccess({ id: "polygon-1" }));

    state.tool = "rotated-box";
    act(() => result.current.createRotatedBbox({ x: 0.2, y: 0.2, w: 0.3, h: 0.2 }));
    expect(state.pendingDrawing).toMatchObject({ kind: "rotated_bbox" });
  });

  it("连续创建在保存成功前保留几何并拒绝下一对象，成功后重新接收", async () => {
    const save = deferred<{ id: string }>();
    const create = vi.fn(() => save.promise);
    const { result, history } = setup({ create });
    act(() => {
      expect(result.current.beginBboxDrawing(geom)).toBe(true);
      expect(result.current.beginBboxDrawing({ ...geom, x: 0.6 })).toBe(false);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.state.pendingDrawing?.creation?.phase).toBe("saving");
    expect(history.push).not.toHaveBeenCalled();
    await act(async () => save.resolve({ id: "created-1" }));
    expect(result.current.state.pendingDrawing).toBeNull();
    expect(result.current.state.selectedId).toBe("created-1");
    expect(history.push).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.beginBboxDrawing({ ...geom, x: 0.6 });
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("业务失败保留同一草稿，重试不重复落库", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue({ id: "retry-1" });
    const { result, history } = setup({ create });
    await act(async () => {
      result.current.beginBboxDrawing(geom);
    });
    const id = result.current.state.pendingDrawing?.creation?.id;
    expect(result.current.state.pendingDrawing?.creation).toMatchObject({ phase: "error" });
    expect(history.push).not.toHaveBeenCalled();
    await act(async () => {
      result.current.submitManualDrawing();
      result.current.submitManualDrawing();
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(id).toBeTruthy();
    expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
    expect(history.push).toHaveBeenCalledTimes(1);
    expect(result.current.state.pendingDrawing).toBeNull();
  });

  it("每个对象重新计算默认属性，缺失字段同步补全并支持条件必填", async () => {
    const toolBindings = {
      ...bindings,
      bbox: {
        ...bindings.bbox,
        attribute_schema: {
          fields: [
            { key: "enabled", type: "boolean", default: false, required: true },
            { key: "count", type: "number", default: 0, required: true },
            { key: "serial", type: "text", required: true, mutable: false },
            {
              key: "reason",
              type: "text",
              required: true,
              visible_if: { key: "enabled", equals: true },
            },
          ],
        },
      },
    };
    const { result, create } = setup({ toolBindings: toolBindings as typeof bindings });
    act(() => {
      result.current.beginBboxDrawing(geom);
    });
    const draft = result.current.state.pendingDrawing!.creation!;
    expect(draft).toMatchObject({
      className: "car",
      phase: "attributes",
      attributes: { enabled: false, count: 0 },
      requiredKeys: ["serial"],
    });
    expect(create).not.toHaveBeenCalled();
    act(() =>
      result.current.changeManualAttributes(draft.id, { enabled: true, count: 0, serial: "fresh" }),
    );
    expect(result.current.state.pendingDrawing?.creation?.requiredKeys).toEqual([
      "serial",
      "reason",
    ]);
    await act(async () => {
      result.current.changeManualAttributes(draft.id, {
        enabled: true,
        count: 0,
        serial: "fresh",
        reason: "checked",
      });
      result.current.submitManualDrawing();
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      attributes: { enabled: true, count: 0, serial: "fresh", reason: "checked" },
    });
    act(() => result.current.beginBboxDrawing({ ...geom, x: 0.6 }));
    expect(result.current.state.pendingDrawing?.creation).toMatchObject({
      phase: "attributes",
      attributes: { enabled: false, count: 0 },
      requiredKeys: ["serial"],
    });
    act(() => result.current.changeManualAttributes(draft.id, { serial: "late" }));
    expect(result.current.state.pendingDrawing?.creation?.attributes).toEqual({
      enabled: false,
      count: 0,
    });
  });

  it("A→B→A 期间旧成功不写新题的选择、草稿或撤销栈", async () => {
    const save = deferred<{ id: string }>();
    const { result, rerender, history } = setup({ create: vi.fn(() => save.promise) });
    act(() => result.current.beginBboxDrawing(geom));
    rerender({ taskId: "task-2", locked: false });
    act(() => {
      result.current.state.setPendingDrawing(null);
      result.current.state.setSelectedId("other-selection");
    });
    rerender({ taskId: "task-1", locked: false });
    await act(async () => save.resolve({ id: "old-created" }));
    expect(result.current.state.selectedId).toBe("other-selection");
    expect(result.current.state.pendingDrawing).toBeNull();
    expect(history.push).not.toHaveBeenCalled();
  });

  it("离线创建必须等待持久化接收；失败留稿，没有虚假对象或历史", async () => {
    const durable = deferred<void>();
    enqueueDurably.mockReturnValueOnce(durable.promise);
    const { result, queryClient, history } = setup({
      create: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    await act(async () => {
      result.current.beginBboxDrawing(geom);
    });
    expect(result.current.state.pendingDrawing?.creation?.phase).toBe("saving");
    expect(queryClient.getQueryData(["annotations", "task-1"])).toBeUndefined();
    await act(async () => durable.reject(new Error("quota")));
    expect(result.current.state.pendingDrawing?.creation?.phase).toBe("error");
    expect(history.push).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["annotations", "task-1"])).toBeUndefined();
    await act(async () => result.current.submitManualDrawing());
    expect(result.current.state.pendingDrawing).toBeNull();
    expect(queryClient.getQueryData(["annotations", "task-1"])).toHaveLength(1);
    expect(history.push).toHaveBeenCalledTimes(1);
  });

  it("安全确认路径与连续路径生成相同 payload", async () => {
    const normal = setup({ intent: null });
    act(() => normal.result.current.beginBboxDrawing(geom));
    expect(normal.result.current.state.pendingDrawing?.creation?.phase).toBe("class");
    await act(async () => normal.result.current.handlePickPendingClass("car"));
    const repeated = setup();
    await act(async () => repeated.result.current.beginBboxDrawing(geom));
    expect(normal.create.mock.calls[0][0]).toEqual(repeated.create.mock.calls[0][0]);
  });

  it("Esc 分别取消关键点半成品和待属性几何；保存中不能取消", async () => {
    const points = setup({
      tool: "keypoint",
      intent: { ...continuous, tool: "keypoint", toolUnitId: "keypoint" },
    });
    act(() => points.result.current.keypointHandle.addPoint({ x: 0.1, y: 0.2, v: 2 }));
    expect(points.result.current.hasManualDraft).toBe(true);
    act(() => {
      expect(points.result.current.cancelManualDrawing()).toBe(true);
    });
    expect(points.result.current.keypointHandle.points).toHaveLength(0);
    act(() => {
      expect(points.result.current.cancelManualDrawing()).toBe(false);
    });
    const save = deferred<{ id: string }>();
    const saving = setup({ create: vi.fn(() => save.promise) });
    act(() => saving.result.current.beginBboxDrawing(geom));
    act(() => {
      expect(saving.result.current.cancelManualDrawing()).toBe(true);
    });
    expect(saving.result.current.state.pendingDrawing?.creation?.phase).toBe("saving");
    await act(async () => save.resolve({ id: "saved" }));
  });

  it.each(["polygon", "keypoint"] as const)(
    "任务锁定清除 %s 半成品，解锁后从空草稿开始",
    (tool) => {
      const { result, rerender, create } = setup({
        tool,
        intent: { ...continuous, tool, toolUnitId: tool === "polygon" ? "region" : "keypoint" },
      });
      act(() => {
        if (tool === "polygon") result.current.polygonHandle.addPoint([0.2, 0.3]);
        else result.current.keypointHandle.addPoint({ x: 0.2, y: 0.3, v: 2 });
      });
      expect(result.current.hasManualDraft).toBe(true);
      rerender({ taskId: "task-1", locked: true });
      expect(result.current.hasManualDraft).toBe(false);
      rerender({ taskId: "task-1", locked: false });
      expect(result.current.polygonHandle.points).toHaveLength(0);
      expect(result.current.keypointHandle.points).toHaveLength(0);
      expect(create).not.toHaveBeenCalled();
    },
  );
});
