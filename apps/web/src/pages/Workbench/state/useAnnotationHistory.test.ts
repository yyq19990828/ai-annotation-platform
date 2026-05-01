// v0.6.3 P1 单测：覆盖 v0.6.3 新增的 applyLeaf tmpId undo 本地分支。
//
// 思路：直接测从 hook 模块导出的纯函数 applyLeaf，构造 mock handlers，
// 不需要 React 渲染环境。

import { describe, expect, it, vi } from "vitest";
import { applyLeaf, type HistoryHandlers } from "./useAnnotationHistory";

function makeHandlers(over: Partial<HistoryHandlers> = {}): HistoryHandlers {
  return {
    createAnnotation: vi.fn(async () => ({ id: "real-1" } as never)),
    deleteAnnotation: vi.fn(async () => ({})),
    updateAnnotation: vi.fn(async () => ({})),
    ...over,
  };
}

const dummyPayload = { annotation_type: "bbox", class_name: "x", geometry: {} as never };

describe("applyLeaf · create undo (v0.6.3 P0 tmpId 本地分支)", () => {
  it("annotationId 是 tmpId 且 removeLocalCreate 提供 → 走本地分支，不调 deleteAnnotation", async () => {
    const removeLocalCreate = vi.fn(async () => {});
    const h = makeHandlers({ removeLocalCreate });

    await applyLeaf(
      { kind: "create", annotationId: "tmp_abc", payload: dummyPayload },
      "undo",
      h,
    );

    expect(removeLocalCreate).toHaveBeenCalledWith("tmp_abc");
    expect(h.deleteAnnotation).not.toHaveBeenCalled();
  });

  it("annotationId 是真实 id → 调 deleteAnnotation", async () => {
    const removeLocalCreate = vi.fn(async () => {});
    const h = makeHandlers({ removeLocalCreate });

    await applyLeaf(
      { kind: "create", annotationId: "real-uuid", payload: dummyPayload },
      "undo",
      h,
    );

    expect(h.deleteAnnotation).toHaveBeenCalledWith("real-uuid");
    expect(removeLocalCreate).not.toHaveBeenCalled();
  });

  it("annotationId 是 tmpId 但 removeLocalCreate 未提供 → 退回 deleteAnnotation（向后兼容）", async () => {
    const h = makeHandlers(); // removeLocalCreate undefined

    await applyLeaf(
      { kind: "create", annotationId: "tmp_xyz", payload: dummyPayload },
      "undo",
      h,
    );

    expect(h.deleteAnnotation).toHaveBeenCalledWith("tmp_xyz");
  });
});

describe("applyLeaf · create redo / update / delete 不受 tmpId 分支影响", () => {
  it("redo create → 调 createAnnotation，cmd.annotationId 改写为新 id", async () => {
    const h = makeHandlers({
      createAnnotation: vi.fn(async () => ({ id: "fresh-1" } as never)),
    });
    const cmd = { kind: "create" as const, annotationId: "tmp_x", payload: dummyPayload };

    await applyLeaf(cmd, "redo", h);

    expect(h.createAnnotation).toHaveBeenCalledWith(dummyPayload);
    expect(cmd.annotationId).toBe("fresh-1");
  });

  it("update undo → 用 before 调 updateAnnotation", async () => {
    const h = makeHandlers();
    await applyLeaf(
      { kind: "update", annotationId: "id", before: { class_name: "A" }, after: { class_name: "B" } },
      "undo",
      h,
    );
    expect(h.updateAnnotation).toHaveBeenCalledWith("id", { class_name: "A" });
  });

  it("update redo → 用 after 调 updateAnnotation", async () => {
    const h = makeHandlers();
    await applyLeaf(
      { kind: "update", annotationId: "id", before: { class_name: "A" }, after: { class_name: "B" } },
      "redo",
      h,
    );
    expect(h.updateAnnotation).toHaveBeenCalledWith("id", { class_name: "B" });
  });
});
