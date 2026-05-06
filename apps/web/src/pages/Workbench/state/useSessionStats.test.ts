/**
 * v0.8.3 · useSessionStats ring buffer 单测。
 *
 * 覆盖：
 *  - < MIN_SAMPLES (10) 时 avgMs=null，etaMs=null
 *  - ≥ MIN_SAMPLES 时 avgMs=平均，etaMs(n)=avg*n
 *  - dt < 1.5s 误触 / dt > 30min 离场被过滤
 *  - 满 RING_SIZE (20) 时旧样本被丢弃
 *  - formatDuration 边界（mm:ss / h:mm / 负值）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStats, formatDuration } from "./useSessionStats";

describe("formatDuration", () => {
  it("负数返回 —", () => {
    expect(formatDuration(-1)).toBe("—");
  });
  it("分钟:秒 (< 1h)", () => {
    expect(formatDuration(65 * 1000)).toBe("1:05");
    expect(formatDuration(125 * 1000)).toBe("2:05");
  });
  it("小时:分 (≥ 1h)", () => {
    expect(formatDuration(3600 * 1000)).toBe("1:00");
    expect(formatDuration(3725 * 1000)).toBe("1:02");
  });
});

describe("useSessionStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number) {
    vi.setSystemTime(new Date(Date.now() + ms));
  }

  it("首次切换不入样本（无前一次 tick）", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSessionStats(id),
      { initialProps: { id: "t1" } as { id: string | null } },
    );
    expect(result.current.samplesCount).toBe(0);
    expect(result.current.avgMs).toBeNull();
    expect(result.current.etaMs(5)).toBeNull();

    advance(5_000);
    rerender({ id: "t2" });
    // 现在累计 1 个样本
    expect(result.current.samplesCount).toBe(1);
    // 仍 < MIN_SAMPLES = 10
    expect(result.current.avgMs).toBeNull();
  });

  it("累计 10 个样本 → avgMs 与 etaMs 报值", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSessionStats(id),
      { initialProps: { id: "t0" } as { id: string | null } },
    );
    for (let i = 1; i <= 10; i++) {
      advance(2_000);
      rerender({ id: `t${i}` });
    }
    expect(result.current.samplesCount).toBe(10);
    // 每次间隔 2s
    expect(result.current.avgMs).toBe(2_000);
    expect(result.current.etaMs(3)).toBe(6_000);
    expect(result.current.etaMs(0)).toBeNull();
  });

  it("dt < 1.5s 与 dt > 30min 都被过滤", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSessionStats(id),
      { initialProps: { id: "t0" } as { id: string | null } },
    );
    advance(500);
    rerender({ id: "t1" });
    expect(result.current.samplesCount).toBe(0);

    advance(31 * 60 * 1000);
    rerender({ id: "t2" });
    expect(result.current.samplesCount).toBe(0);

    advance(2_000);
    rerender({ id: "t3" });
    expect(result.current.samplesCount).toBe(1);
  });

  it("满 RING_SIZE=20 时丢弃最旧样本", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSessionStats(id),
      { initialProps: { id: "t0" } as { id: string | null } },
    );
    for (let i = 1; i <= 25; i++) {
      advance(2_000);
      rerender({ id: `t${i}` });
    }
    expect(result.current.samplesCount).toBe(20);
  });

  it("currentTaskId=null 时 useEffect 提前退出", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSessionStats(id),
      { initialProps: { id: null } as { id: string | null } },
    );
    expect(result.current.samplesCount).toBe(0);
    advance(5_000);
    rerender({ id: null });
    expect(result.current.samplesCount).toBe(0);
  });

  it("act 包装：相同 id 重复 rerender 不增样本", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSessionStats(id),
      { initialProps: { id: "t1" } as { id: string | null } },
    );
    advance(3_000);
    act(() => rerender({ id: "t1" }));
    expect(result.current.samplesCount).toBe(0);
  });
});
