// issue 图钉子 hook 单测:open 计数派生 + 列表聚焦联动(image 平移视口 / video seek 帧)。
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIssuePins } from "./useIssuePins";

// 可变 store 状态:测试改 focusTick / highlightId 后 rerender 触发聚焦 effect。
const storeState = {
  highlightId: "" as string,
  highlightFromPin: vi.fn(),
  requestIssuesTab: vi.fn(),
  focusTick: 0,
};
let feedbackItems: Array<Record<string, unknown>> = [];

vi.mock("./useActiveIssueStore", () => ({
  useActiveIssueStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
vi.mock("@/hooks/useFeedbacks", () => ({
  useFeedbacks: () => ({ data: { items: feedbackItems } }),
}));

const stageGeom = { imgW: 1000, imgH: 800, vpSize: { w: 600, h: 400 } };

function setup(over: Partial<Parameters<typeof useIssuePins>[0]> = {}) {
  const setVp = vi.fn();
  const setVideoFrameIndex = vi.fn();
  const view = renderHook(
    (p: { isVideoTask: boolean }) =>
      useIssuePins({
        projectId: "P1",
        taskId: "T1",
        stageGeom,
        setVp,
        setVideoFrameIndex,
        isVideoTask: p.isVideoTask,
        ...over,
      }),
    {
      initialProps: { isVideoTask: false },
    },
  );
  return { ...view, setVp, setVideoFrameIndex };
}

describe("useIssuePins", () => {
  beforeEach(() => {
    storeState.highlightId = "";
    storeState.focusTick = 0;
    feedbackItems = [];
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  it("openIssueCount 只数 status=open", () => {
    feedbackItems = [
      { id: "a", status: "open" },
      { id: "b", status: "resolved" },
      { id: "c", status: "open" },
    ];
    const { result } = setup();
    expect(result.current.openIssueCount).toBe(2);
  });

  it("focusTick 变化 + image 任务 → 平移视口到图钉(setVp)", () => {
    feedbackItems = [{ id: "iss-1", status: "open", anchor_position: { x: 0.5, y: 0.5 } }];
    storeState.highlightId = "iss-1";
    const { rerender, setVp, setVideoFrameIndex } = setup();
    expect(setVp).not.toHaveBeenCalled(); // 初次挂载 focusTick 未变,不动
    storeState.focusTick = 1;
    rerender({ isVideoTask: false });
    expect(setVp).toHaveBeenCalledTimes(1);
    expect(setVideoFrameIndex).not.toHaveBeenCalled();
  });

  it("focusTick 变化 + video 任务 → seek 到 anchor 帧(setVideoFrameIndex)", () => {
    feedbackItems = [
      { id: "iss-1", status: "open", anchor_position: { x: 0.5, y: 0.5, frame: 42 } },
    ];
    storeState.highlightId = "iss-1";
    const { rerender, setVp, setVideoFrameIndex } = setup({ isVideoTask: true });
    storeState.focusTick = 1;
    rerender({ isVideoTask: true });
    expect(setVideoFrameIndex).toHaveBeenCalledWith(42);
    expect(setVp).not.toHaveBeenCalled();
  });

  it("focusTick 变化但目标无 anchor_position → 不动视口", () => {
    feedbackItems = [{ id: "iss-1", status: "open" }];
    storeState.highlightId = "iss-1";
    const { rerender, setVp } = setup();
    storeState.focusTick = 1;
    rerender({ isVideoTask: false });
    expect(setVp).not.toHaveBeenCalled();
  });
});
