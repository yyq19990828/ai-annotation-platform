// AI 预标浮层边框状态单测:尺寸从 localStorage 初始化 / 变更持久化 / 置空清除。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAiPopoverFrame } from "./useAiPopoverFrame";

const KEY = "wb:ai-popover-size";

describe("useAiPopoverFrame", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("无存储 → 尺寸初始为 null,位置初始为 null", () => {
    const { result } = renderHook(() => useAiPopoverFrame());
    expect(result.current.aiPopoverSize).toBeNull();
    expect(result.current.aiPopoverPosition).toBeNull();
  });

  it("已存合法尺寸 → 初始化时读回", () => {
    localStorage.setItem(KEY, JSON.stringify({ w: 320, h: 240 }));
    const { result } = renderHook(() => useAiPopoverFrame());
    expect(result.current.aiPopoverSize).toEqual({ w: 320, h: 240 });
  });

  it("存储非法(缺字段)→ 回退 null,不抛", () => {
    localStorage.setItem(KEY, JSON.stringify({ w: 320 }));
    const { result } = renderHook(() => useAiPopoverFrame());
    expect(result.current.aiPopoverSize).toBeNull();
  });

  it("设尺寸 → 写入 localStorage;置空 → 移除", () => {
    const { result } = renderHook(() => useAiPopoverFrame());
    act(() => result.current.setAiPopoverSize({ w: 400, h: 300 }));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ w: 400, h: 300 });
    act(() => result.current.setAiPopoverSize(null));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
