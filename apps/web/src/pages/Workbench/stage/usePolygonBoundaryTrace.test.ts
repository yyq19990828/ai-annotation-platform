import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Annotation, AnnotationResponse, PolygonGeometry } from "@/types";
import type { Pt } from "./polygonGeom";
import type { PolygonDraftHandle } from "./tools";
import { usePolygonBoundaryTrace } from "./usePolygonBoundaryTrace";

const geometry: PolygonGeometry = {
  type: "polygon",
  points: [
    [0.1, 0.1],
    [0.8, 0.1],
    [0.8, 0.8],
    [0.1, 0.8],
  ],
};
const source = { id: "saved-1", version: 1, geometry } as Annotation;

function setup() {
  let points: Pt[] = [[0.1, 0.1]];
  let resolve!: (value: AnnotationResponse | null) => void;
  let reject!: (reason: Error) => void;
  const readSource = vi.fn(
    (_id: string, _signal: AbortSignal) =>
      new Promise<AnnotationResponse | null>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  const append = vi.fn((batch: Pt[], expected: Pt[]) => {
    if (points !== expected) return false;
    points = [...points, ...batch];
    return true;
  });
  const beforeInput: NonNullable<PolygonDraftHandle["beforeInput"]> = { current: null };
  const initial = {
    enabled: true,
    owner: "task-1",
    annotations: [source],
    width: 1000,
    height: 500,
    draft: {
      points,
      addPoint: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      beforeInput,
      boundaryTrace: { getPoints: () => points, append, readSource },
    },
  };
  const hook = renderHook(usePolygonBoundaryTrace, { initialProps: initial });
  const preview = () => {
    act(() => hook.result.current.begin());
    act(() => hook.result.current.pick([0.1, 0.1]));
    act(() => hook.result.current.pick([0.1, 0.5]));
    expect(hook.result.current.trace?.direction).toBe("counterclockwise");
  };
  const finish = async (value: unknown) =>
    act(async () => {
      resolve(value as AnnotationResponse | null);
    });
  return {
    hook,
    initial,
    preview,
    append,
    readSource,
    finish,
    fail: () =>
      act(async () => {
        reject(new Error("network unavailable"));
      }),
    beforeInput,
    getPoints: () => points,
    changeDraft: () => {
      points = [];
    },
  };
}

describe("polygon boundary preview ownership", () => {
  it("retains a failed verification for retry, and Enter confirms the preview before draft submission", async () => {
    const v = setup();
    v.preview();
    act(() =>
      expect(v.beforeInput.current?.(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true),
    );
    await v.fail();
    expect(v.hook.result.current.trace?.error).toMatch(/检查连接后重试/);
    expect(v.hook.result.current.trace?.paths).toBeDefined();
    expect(v.getPoints()).toEqual([[0.1, 0.1]]);
    act(() => {
      void v.hook.result.current.confirm();
    });
    await v.finish(source);
    expect(v.readSource).toHaveBeenCalledTimes(2);
    expect(v.append).toHaveBeenCalledTimes(1);
    v.hook.unmount();
  });
  it("verifies the frozen source, appends once and keeps draft endpoint deduplication", async () => {
    const v = setup();
    v.preview();
    act(() => {
      void v.hook.result.current.confirm();
      void v.hook.result.current.confirm();
    });
    expect(v.readSource).toHaveBeenCalledTimes(1);
    expect(v.append).not.toHaveBeenCalled();
    await v.finish(source);
    expect(v.append).toHaveBeenCalledTimes(1);
    expect(v.getPoints()).toEqual([
      [0.1, 0.1],
      [0.1, 0.5],
    ]);
    expect(v.hook.result.current.trace).toBeNull();
    v.hook.unmount();
    expect(v.beforeInput.current).toBeNull();
  });
  it.each([
    null,
    { ...source, version: 2 },
    { ...source, geometry: { ...geometry, points: [...geometry.points, [0, 0]] } },
  ])("rejects an absent or changed server source", async (result) => {
    const v = setup();
    v.preview();
    act(() => {
      void v.hook.result.current.confirm();
    });
    await v.finish(result);
    expect(v.hook.result.current.trace?.error).toMatch(/来源已修改/);
    expect(v.hook.result.current.trace?.paths).toBeUndefined();
    expect(v.append).not.toHaveBeenCalled();
    v.hook.unmount();
  });
  it.each(["owner", "disabled", "cancel", "draft", "unmount"])(
    "ignores verification after %s retires the preview",
    async (change) => {
      const v = setup();
      v.preview();
      act(() => {
        void v.hook.result.current.confirm();
      });
      if (change === "owner") v.hook.rerender({ ...v.initial, owner: "task-2" });
      if (change === "disabled") v.hook.rerender({ ...v.initial, enabled: false });
      if (change === "cancel") act(() => v.hook.result.current.cancel());
      if (change === "draft") {
        v.changeDraft();
        v.hook.rerender({ ...v.initial });
      }
      if (change === "unmount") v.hook.unmount();
      expect(v.readSource.mock.calls[0][1].aborted).toBe(true);
      await v.finish(source);
      expect(v.append).not.toHaveBeenCalled();
      if (change !== "unmount") v.hook.unmount();
    },
  );
  it("invalidates immediately on a locally observed source update, while Escape preserves the draft", () => {
    const v = setup();
    v.preview();
    v.hook.rerender({ ...v.initial, annotations: [{ ...source, version: 2 }] });
    expect(v.hook.result.current.trace?.invalid).toBe(true);
    act(() =>
      expect(v.beforeInput.current?.(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(true),
    );
    expect(v.getPoints()).toEqual([[0.1, 0.1]]);
    expect(v.hook.result.current.trace).toBeNull();
    v.hook.unmount();
  });
});
