import { describe, expect, it, vi } from "vitest";

import { ByteLru } from "./videoByteLru";

describe("ByteLru · 字节预算 LRU", () => {
  it("get 命中刷新最近使用顺序;超出预算时淘汰最旧项", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(20);
    lru.set("a", { value: 1, bytes: 10, dispose });
    lru.set("b", { value: 2, bytes: 10, dispose }); // 20 bytes 刚好不淘汰
    expect(lru.get("a")).toBe(1); // a 提到最近使用 → 顺序 [b, a]
    lru.set("c", { value: 3, bytes: 10, dispose }); // 30 > 20 → 淘汰最旧 b
    expect(lru.has("b")).toBe(false);
    expect(lru.has("a")).toBe(true);
    expect(lru.has("c")).toBe(true);
    expect(dispose).toHaveBeenCalledWith(2);
  });

  it("按 bytes 而非 item 数淘汰:一项即可驱逐多项目", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(10);
    lru.set("a", { value: 1, bytes: 4, dispose });
    lru.set("b", { value: 2, bytes: 4, dispose });
    expect(lru.size).toBe(2);
    expect(lru.bytes).toBe(8);
    lru.set("c", { value: 3, bytes: 10, dispose }); // 8+10=18 → 淘汰 a(14)→ 淘汰 b(10)
    expect(lru.size).toBe(1);
    expect(lru.has("c")).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("超大单项 (>budget) 拒绝入缓存并返回 false", () => {
    const lru = new ByteLru<string, number>(5);
    const ok = lru.set("big", { value: 1, bytes: 100, dispose: vi.fn() });
    expect(ok).toBe(false);
    expect(lru.size).toBe(0);
    expect(lru.bytes).toBe(0);
  });

  it("覆盖已存在 key:旧值 dispose 一次且字节账更新", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(100);
    lru.set("a", { value: 1, bytes: 10, dispose });
    lru.set("a", { value: 2, bytes: 20, dispose });
    expect(lru.bytes).toBe(20);
    expect(lru.get("a")).toBe(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(1);
  });

  it("setBudget 下调立即淘汰;上调不主动加载", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(100);
    lru.set("a", { value: 1, bytes: 30, dispose });
    lru.set("b", { value: 2, bytes: 30, dispose });
    lru.set("c", { value: 3, bytes: 30, dispose }); // 90 bytes
    expect(lru.size).toBe(3);
    const evicted = lru.setBudget(50); // 90 > 50 → 淘汰 a(60)→ 淘汰 b(30)
    expect(evicted).toBe(2);
    expect(lru.has("c")).toBe(true);
    expect(lru.bytes).toBe(30);
    expect(dispose).toHaveBeenCalledTimes(2);
    lru.setBudget(200); // 上调
    expect(lru.bytes).toBe(30);
  });

  it("clear 释放全部并各调用一次 dispose", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(100);
    lru.set("a", { value: 1, bytes: 10, dispose });
    lru.set("b", { value: 2, bytes: 20, dispose });
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.bytes).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("delete 调用一次 dispose 并修正字节账;未命中返回 false", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(100);
    lru.set("a", { value: 1, bytes: 15, dispose });
    expect(lru.delete("a")).toBe(true);
    expect(lru.bytes).toBe(0);
    expect(dispose).toHaveBeenCalledWith(1);
    expect(lru.delete("missing")).toBe(false);
  });

  it("零预算:任何写入都拒绝", () => {
    const lru = new ByteLru<string, number>(0);
    expect(lru.set("a", { value: 1, bytes: 1, dispose: vi.fn() })).toBe(false);
    expect(lru.size).toBe(0);
    expect(lru.budgetBytes).toBe(0);
  });

  it("空缓存 get/delete/clear 无副作用", () => {
    const lru = new ByteLru<string, number>(100);
    expect(lru.get("x")).toBeUndefined();
    expect(lru.delete("x")).toBe(false);
    expect(() => lru.clear()).not.toThrow();
    expect(lru.evictions).toBe(0);
  });

  it("evictions 计数累计淘汰次数", () => {
    const lru = new ByteLru<string, number>(10);
    lru.set("a", { value: 1, bytes: 5, dispose: vi.fn() });
    lru.set("b", { value: 2, bytes: 5, dispose: vi.fn() });
    lru.set("c", { value: 3, bytes: 5, dispose: vi.fn() }); // 15 > 10 → 淘汰 a
    expect(lru.evictions).toBe(1);
  });

  it("拒绝负数 / 非有限 entry bytes", () => {
    const lru = new ByteLru<string, number>(100);
    expect(() => lru.set("a", { value: 1, bytes: -1, dispose: vi.fn() })).toThrow();
    expect(() =>
      lru.set("a", { value: 1, bytes: Number.POSITIVE_INFINITY, dispose: vi.fn() }),
    ).toThrow();
    expect(() => lru.set("a", { value: 1, bytes: Number.NaN, dispose: vi.fn() })).toThrow();
  });

  it("拒绝负数 / 非有限 budget(构造与 setBudget)", () => {
    expect(() => new ByteLru<string, number>(-1)).toThrow();
    expect(() => new ByteLru<string, number>(Number.NaN)).toThrow();
    const lru = new ByteLru<string, number>(100);
    expect(() => lru.setBudget(-1)).toThrow();
    expect(() => lru.setBudget(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("entries 暴露当前 [key, value]", () => {
    const lru = new ByteLru<string, { n: number }>(100);
    lru.set("a", { value: { n: 1 }, bytes: 10 });
    lru.set("b", { value: { n: 2 }, bytes: 20 });
    expect([...lru.entries()]).toEqual([
      ["a", { n: 1 }],
      ["b", { n: 2 }],
    ]);
    expect([...lru.keys()]).toEqual(["a", "b"]);
  });

  it("pin 的活动项由调用方保护:写入前 get 提到最近可避开淘汰", () => {
    const dispose = vi.fn();
    const lru = new ByteLru<string, number>(20);
    lru.set("active", { value: 1, bytes: 10, dispose });
    lru.set("buf", { value: 2, bytes: 10, dispose }); // [active, buf], 20 bytes
    // 展示新帧前先把活动项 get 到最近 → 顺序 [buf, active]
    lru.get("active");
    lru.set("new", { value: 3, bytes: 10, dispose }); // 30 > 20 → 淘汰最旧 buf,保留 active
    expect(lru.has("active")).toBe(true);
    expect(lru.has("buf")).toBe(false);
    expect(lru.has("new")).toBe(true);
  });
});
