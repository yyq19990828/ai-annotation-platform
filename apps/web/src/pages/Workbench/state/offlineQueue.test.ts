// v0.6.3 P1 单测：覆盖 v0.6.3 新增的 replaceAnnotationId 与 drain 失败累计 retry_count。
//
// 思路：mock idb-keyval 为内存 Map，直接测公共导出的纯异步 API，
// 不依赖 IndexedDB / BroadcastChannel（jsdom 也不需要）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const idbStore = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => idbStore.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
}));

import {
  clearAll,
  drain,
  enqueue,
  getAll,
  replaceAnnotationId,
  type OfflineOp,
} from "./offlineQueue";

beforeEach(async () => {
  idbStore.clear();
  await clearAll();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("offlineQueue.replaceAnnotationId", () => {
  it("把队列中后续 update / delete op 的 annotationId 同步替换", async () => {
    const tmp = "tmp_abc";
    await enqueue({ kind: "create", id: "op1", taskId: "t1", tmpId: tmp, payload: {}, ts: 1 });
    await enqueue({ kind: "update", id: "op2", taskId: "t1", annotationId: tmp, payload: { foo: 1 }, ts: 2 });
    await enqueue({ kind: "delete", id: "op3", taskId: "t1", annotationId: tmp, ts: 3 });
    await enqueue({ kind: "update", id: "op4", taskId: "t1", annotationId: "other", payload: {}, ts: 4 });

    await replaceAnnotationId(tmp, "real-1");

    const all = await getAll();
    expect(all).toHaveLength(4);
    // create 的 tmpId 字段不动（执行 create 时调用方自己换 cache，drain 自然消费）
    expect((all[0] as Extract<OfflineOp, { kind: "create" }>).tmpId).toBe(tmp);
    // update / delete 的 annotationId 已替换
    expect((all[1] as Extract<OfflineOp, { kind: "update" }>).annotationId).toBe("real-1");
    expect((all[2] as Extract<OfflineOp, { kind: "delete" }>).annotationId).toBe("real-1");
    // 不是目标 tmpId 的 op 不动
    expect((all[3] as Extract<OfflineOp, { kind: "update" }>).annotationId).toBe("other");
  });

  it("无匹配项时不写盘", async () => {
    await enqueue({ kind: "update", id: "op1", taskId: "t1", annotationId: "x", payload: {}, ts: 1 });
    await replaceAnnotationId("not-in-queue", "anything");
    const all = await getAll();
    expect((all[0] as Extract<OfflineOp, { kind: "update" }>).annotationId).toBe("x");
  });
});

describe("offlineQueue.drain · retry_count 累计 + 失败时停止", () => {
  it("handler 抛错 → op.retry_count +1，op 仍留队列", async () => {
    await enqueue({ kind: "delete", id: "op1", taskId: "t1", annotationId: "a", ts: 1 });
    const handler = vi.fn(async () => { throw new Error("network"); });

    const result = await drain(handler);
    expect(result).toEqual({ ok: 0, failed: 1 });

    const all = await getAll();
    expect(all).toHaveLength(1);
    expect(all[0].retry_count).toBe(1);

    // 再 drain 一次应继续累加
    const result2 = await drain(handler);
    expect(result2).toEqual({ ok: 0, failed: 1 });
    const all2 = await getAll();
    expect(all2[0].retry_count).toBe(2);
  });

  it("成功的 op 出队，不写 retry_count", async () => {
    await enqueue({ kind: "delete", id: "op1", taskId: "t1", annotationId: "a", ts: 1 });
    await enqueue({ kind: "delete", id: "op2", taskId: "t1", annotationId: "b", ts: 2 });
    const result = await drain(async () => { /* ok */ });
    expect(result).toEqual({ ok: 2, failed: 0 });
    const all = await getAll();
    expect(all).toHaveLength(0);
  });

  it("半路失败 → 已成功部分出队，失败 op 累计 retry_count，后续保留", async () => {
    await enqueue({ kind: "delete", id: "ok1", taskId: "t1", annotationId: "a", ts: 1 });
    await enqueue({ kind: "delete", id: "fail", taskId: "t1", annotationId: "b", ts: 2 });
    await enqueue({ kind: "delete", id: "later", taskId: "t1", annotationId: "c", ts: 3 });
    let calls = 0;
    const handler = vi.fn(async () => { calls++; if (calls === 2) throw new Error("boom"); });

    const result = await drain(handler);
    expect(result).toEqual({ ok: 1, failed: 1 });
    const all = await getAll();
    expect(all.map((o) => o.id)).toEqual(["fail", "later"]);
    expect(all[0].retry_count).toBe(1);
    expect(all[1].retry_count).toBeUndefined();
  });
});
