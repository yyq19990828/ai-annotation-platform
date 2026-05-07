// v0.6.3 P1 单测：覆盖 v0.6.3 新增的 applyLeaf tmpId undo 本地分支。
//
// 思路：直接测从 hook 模块导出的纯函数 applyLeaf，构造 mock handlers，
// 不需要 React 渲染环境。

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLeaf,
  loadHistoryFromSession,
  saveHistoryToSession,
  type Command,
  type HistoryHandlers,
} from "./useAnnotationHistory";

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


// ── v0.8.7 F8 · sessionStorage 持久化 ────────────────────────────────

describe("history sessionStorage 持久化", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") window.sessionStorage.clear();
  });

  const sample: Command = {
    kind: "create",
    annotationId: "ann_1",
    payload: {
      annotation_type: "bbox",
      class_name: "car",
      geometry: {} as never,
    },
  };

  it("save → load round-trip 同 taskId", () => {
    saveHistoryToSession("task-A", [sample], []);
    const back = loadHistoryFromSession("task-A");
    expect(back?.undo).toHaveLength(1);
    expect(back?.undo[0].kind).toBe("create");
  });

  it("空栈写时清除 key", () => {
    saveHistoryToSession("task-A", [sample], []);
    saveHistoryToSession("task-A", [], []);
    expect(loadHistoryFromSession("task-A")).toBeNull();
  });

  it("TTL 过期不 restore 并自清", () => {
    const expired = JSON.stringify({
      undo: [sample],
      redo: [],
      ts: Date.now() - 6 * 60 * 1000, // 6min
    });
    window.sessionStorage.setItem("wb:hist:task-old", expired);
    expect(loadHistoryFromSession("task-old")).toBeNull();
    expect(window.sessionStorage.getItem("wb:hist:task-old")).toBeNull();
  });

  it("不同 taskId 互相隔离", () => {
    saveHistoryToSession("task-A", [sample], []);
    saveHistoryToSession("task-B", [], []);
    expect(loadHistoryFromSession("task-A")?.undo).toHaveLength(1);
    expect(loadHistoryFromSession("task-B")).toBeNull();
  });

  it("undefined taskId 不写不读", () => {
    saveHistoryToSession(undefined, [sample], []);
    expect(loadHistoryFromSession(undefined)).toBeNull();
  });

  it("损坏 JSON 静默忽略", () => {
    window.sessionStorage.setItem("wb:hist:bad", "{not json");
    expect(loadHistoryFromSession("bad")).toBeNull();
  });
});
