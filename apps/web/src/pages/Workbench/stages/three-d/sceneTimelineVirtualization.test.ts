import { describe, expect, it } from "vitest";

import {
  SCENE_TIMELINE_MAX_WINDOW,
  densityRatio,
  timelineQueryRange,
} from "./sceneTimelineVirtualization";

describe("sceneTimelineVirtualization", () => {
  it("keeps a 10000-frame scene request bounded around the virtual viewport", () => {
    const range = timelineQueryRange({
      sceneStart: 0,
      sceneEnd: 9999,
      firstVirtualIndex: 4988,
      lastVirtualIndex: 5020,
    });

    expect(range).toEqual({ startFrame: 4976, endFrame: 5032 });
    expect(range.endFrame - range.startFrame + 1).toBeLessThanOrEqual(SCENE_TIMELINE_MAX_WINDOW);
  });

  it("clamps window padding at scene boundaries", () => {
    expect(
      timelineQueryRange({
        sceneStart: 100,
        sceneEnd: 120,
        firstVirtualIndex: 0,
        lastVirtualIndex: 8,
      }),
    ).toEqual({ startFrame: 100, endFrame: 120 });
  });

  it("normalizes density without exceeding one", () => {
    expect(densityRatio(0, 10)).toBe(0);
    expect(densityRatio(5, 10)).toBe(0.5);
    expect(densityRatio(12, 10)).toBe(1);
  });
});
