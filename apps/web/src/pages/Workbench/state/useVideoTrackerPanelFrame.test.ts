import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useVideoTrackerPanelFrame } from "./useVideoTrackerPanelFrame";

const POSITION_KEY = "wb:video-tracker-panel-position";
const SIZE_KEY = "wb:video-tracker-panel-size";

describe("useVideoTrackerPanelFrame", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("恢复已保存的追踪面板位置和尺寸", () => {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: 120, top: 80 }));
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: 420, h: 560 }));

    const { result } = renderHook(() => useVideoTrackerPanelFrame());

    expect(result.current.trackerPanelPosition).toEqual({ left: 120, top: 80 });
    expect(result.current.trackerPanelSize).toEqual({ w: 420, h: 560 });
  });

  it("更新位置和尺寸时写入全局 UI 偏好", () => {
    const { result } = renderHook(() => useVideoTrackerPanelFrame());

    act(() => result.current.setTrackerPanelPosition({ left: 160, top: 96 }));
    act(() => result.current.setTrackerPanelSize({ w: 460, h: 600 }));

    expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual({ left: 160, top: 96 });
    expect(JSON.parse(localStorage.getItem(SIZE_KEY)!)).toEqual({ w: 460, h: 600 });
  });
});
