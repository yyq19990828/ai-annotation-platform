/**
 * v0.9.2 · useInteractiveAI hook 单测.
 * 覆盖 point / bbox / text 三种 prompt 路由 + backend 失败 toast + mlBackendId 缺失守卫
 * + 80ms 防抖合并连续点击。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useInteractiveAI } from "./useInteractiveAI";

const interactiveAnnotateMock = vi.fn();
const pushToastMock = vi.fn();

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: {
    interactiveAnnotate: (...args: unknown[]) => interactiveAnnotateMock(...args),
  },
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (s: { push: typeof pushToastMock }) => unknown) =>
    selector({ push: pushToastMock }),
}));

const ARGS = { projectId: "p1", taskId: "t1", mlBackendId: "b1" };

const POLY_RESPONSE = {
  result: [
    {
      type: "polygonlabels",
      value: { points: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]], polygonlabels: ["person"] },
      score: 0.92,
    },
  ],
};

describe("useInteractiveAI", () => {
  beforeEach(() => {
    interactiveAnnotateMock.mockReset();
    pushToastMock.mockReset();
  });

  it("runBbox 路由到 ctx.type='bbox'", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0.1, 0.1, 0.4, 0.4]));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
    const [pid, bid, payload] = interactiveAnnotateMock.mock.calls[0];
    expect(pid).toBe("p1");
    expect(bid).toBe("b1");
    expect(payload.task_id).toBe("t1");
    expect(payload.context.type).toBe("bbox");
    expect(payload.context.bbox).toEqual([0.1, 0.1, 0.4, 0.4]);
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.candidates[0].label).toBe("person");
    expect(result.current.candidates[0].source).toBe("bbox");
  });

  it("runText 路由到 ctx.type='text' 并 trim 空白", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runText("  car  "));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
    expect(interactiveAnnotateMock.mock.calls[0][2].context).toEqual({
      type: "text",
      text: "car",
    });
  });

  it("runText 空字符串不发请求", async () => {
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runText("   "));
    await new Promise((r) => setTimeout(r, 20));
    expect(interactiveAnnotateMock).not.toHaveBeenCalled();
  });

  it("runPoint 80ms 防抖合并连续点击", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useInteractiveAI(ARGS));
      act(() => result.current.runPoint([0.1, 0.1], 1));
      act(() => result.current.runPoint([0.2, 0.2], 1));
      act(() => result.current.runPoint([0.3, 0.3], 1));
      expect(interactiveAnnotateMock).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1);
      expect(interactiveAnnotateMock.mock.calls[0][2].context.points).toEqual([[0.3, 0.3]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Alt+点击 (polarity=0) 透传 negative label", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runPoint([0.5, 0.5], 0));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
    expect(interactiveAnnotateMock.mock.calls[0][2].context.labels).toEqual([0]);
  });

  it("mlBackendId 缺失 → 不发请求 + 弹 toast", async () => {
    const { result } = renderHook(() =>
      useInteractiveAI({ ...ARGS, mlBackendId: null }),
    );
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await new Promise((r) => setTimeout(r, 20));
    expect(interactiveAnnotateMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "项目未绑定 ML Backend", kind: "error" }),
    );
  });

  it("backend 抛错 → 不更新 candidates + 弹错误 toast", async () => {
    interactiveAnnotateMock.mockRejectedValue(new Error("connection refused"));
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ msg: "SAM 推理失败", kind: "error" }),
      ),
    );
    expect(result.current.candidates).toHaveLength(0);
  });

  it("空 result → 提示 + candidates 清空", async () => {
    interactiveAnnotateMock.mockResolvedValue({ result: [] });
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runText("nothing"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ msg: "SAM 未返回候选" }),
      ),
    );
    expect(result.current.candidates).toHaveLength(0);
  });

  it("cycle 在候选间循环切换", async () => {
    interactiveAnnotateMock.mockResolvedValue({
      result: [
        { type: "polygonlabels", value: { points: [[0, 0], [1, 0], [1, 1]], polygonlabels: ["a"] }, score: 0.9 },
        { type: "polygonlabels", value: { points: [[0, 0], [1, 0], [0, 1]], polygonlabels: ["b"] }, score: 0.8 },
        { type: "polygonlabels", value: { points: [[0, 0], [0, 1], [1, 1]], polygonlabels: ["c"] }, score: 0.7 },
      ],
    });
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runText("a b c"));
    await waitFor(() => expect(result.current.candidates).toHaveLength(3));
    expect(result.current.activeIdx).toBe(0);
    act(() => result.current.cycle(1));
    expect(result.current.activeIdx).toBe(1);
    act(() => result.current.cycle(1));
    act(() => result.current.cycle(1));
    expect(result.current.activeIdx).toBe(0); // 3 → 0 wrap
    act(() => result.current.cycle(-1));
    expect(result.current.activeIdx).toBe(2);
  });

  it("cancel 清空候选", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    act(() => result.current.cancel());
    expect(result.current.candidates).toHaveLength(0);
  });
});
