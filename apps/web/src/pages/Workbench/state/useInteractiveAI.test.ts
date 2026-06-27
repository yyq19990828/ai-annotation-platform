/**
 * v0.9.2 · useInteractiveAI hook 单测.
 * 覆盖 point / bbox / text 三种 prompt 路由 + backend 失败 toast + mlBackendId 缺失守卫
 * + 80ms 防抖合并连续点击。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { ApiError } from "@/api/client";
import { useInteractiveAI } from "./useInteractiveAI";

const interactiveAnnotateMock = vi.fn();
const pushToastMock = vi.fn();
const recordPredictCacheHitMock = vi.fn();

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: {
    interactiveAnnotate: (...args: unknown[]) => interactiveAnnotateMock(...args),
  },
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (s: { push: typeof pushToastMock }) => unknown) =>
    selector({ push: pushToastMock }),
}));

vi.mock("./sessionVariantCache", () => ({
  recordPredictCacheHit: (...args: unknown[]) => recordPredictCacheHitMock(...args),
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
    recordPredictCacheHitMock.mockReset();
  });

  it("runBbox 路由到 ctx.type='interactive_box' (v0.18.17 · 旧 bbox 改名)", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0.1, 0.1, 0.4, 0.4]));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
    const [pid, bid, payload] = interactiveAnnotateMock.mock.calls[0];
    expect(pid).toBe("p1");
    expect(bid).toBe("b1");
    expect(payload.task_id).toBe("t1");
    expect(payload.context.type).toBe("interactive_box");
    expect(payload.context.bbox).toEqual([0.1, 0.1, 0.4, 0.4]);
    expect(payload.context.multimask_output).toBe(false);
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.candidates[0].label).toBe("person");
    expect(result.current.candidates[0].source).toBe("bbox");
  });

  it("runPoint 累加全量点 (v0.18.17 · 防抖窗口内多次点击累加成一个会话, 重发全量)", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useInteractiveAI(ARGS));
      act(() => result.current.runPoint([0.1, 0.1], 1));
      act(() => result.current.runPoint([0.2, 0.2], 0));
      act(() => result.current.runPoint([0.3, 0.3], 1));
      expect(interactiveAnnotateMock).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1);
      const ctx = interactiveAnnotateMock.mock.calls[0][2].context;
      // 累加: 全量点 + 对应极性; ≥2 点 → multimask_output=false (单 mask 精修).
      expect(ctx.points).toEqual([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]);
      expect(ctx.labels).toEqual([1, 0, 1]);
      expect(ctx.multimask_output).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runPoint 首点 multimask_output=true (单点歧义出候选)", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runPoint([0.5, 0.5], 1));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
    const ctx = interactiveAnnotateMock.mock.calls[0][2].context;
    expect(ctx.points).toEqual([[0.5, 0.5]]);
    expect(ctx.multimask_output).toBe(true);
  });

  it("§5.4 mask_input 回灌: 首点不回灌, ≥2 点回传上一轮 low-res logits", async () => {
    // 首点 multimask → 后端 mask_input_next=null; 第 2 点起单 mask → 返回 token 供下次回传。
    interactiveAnnotateMock
      .mockResolvedValueOnce({ ...POLY_RESPONSE, mask_input_next: null })
      .mockResolvedValueOnce({ ...POLY_RESPONSE, mask_input_next: "TOKEN_A" })
      .mockResolvedValueOnce({ ...POLY_RESPONSE, mask_input_next: "TOKEN_B" });
    const { result } = renderHook(() => useInteractiveAI(ARGS));

    act(() => result.current.runPoint([0.1, 0.1], 1));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    // 首点候选阶段 (multimask=true) 不回灌。
    expect(interactiveAnnotateMock.mock.calls[0][2].context.mask_input).toBeUndefined();

    act(() => result.current.runPoint([0.2, 0.2], 1));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    // 第 2 点: 上一轮 (首点) 返回 null → maskInputRef 仍空, 不回灌。
    expect(interactiveAnnotateMock.mock.calls[1][2].context.mask_input).toBeUndefined();

    act(() => result.current.runPoint([0.3, 0.3], 1));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(3));
    // 第 3 点: 回传第 2 点返回的 TOKEN_A。
    expect(interactiveAnnotateMock.mock.calls[2][2].context.mask_input).toBe("TOKEN_A");
  });

  it("§5.5 sessionPoints 累加并随 cancel 清空", async () => {
    interactiveAnnotateMock.mockResolvedValue({ ...POLY_RESPONSE, mask_input_next: null });
    const { result } = renderHook(() => useInteractiveAI(ARGS));

    act(() => result.current.runPoint([0.1, 0.1], 1));
    await waitFor(() => expect(result.current.sessionPoints).toHaveLength(1));
    act(() => result.current.runPoint([0.2, 0.2], 0));
    await waitFor(() => expect(result.current.sessionPoints).toHaveLength(2));
    expect(result.current.sessionPoints).toEqual([
      { pt: [0.1, 0.1], polarity: 1 },
      { pt: [0.2, 0.2], polarity: 0 },
    ]);
    act(() => result.current.cancel());
    expect(result.current.sessionPoints).toHaveLength(0);
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
    act(() => result.current.runBbox([0.1, 0.1, 0.2, 0.2]));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ msg: "SAM 未返回候选" }),
      ),
    );
    expect(result.current.candidates).toHaveLength(0);
  });

  it("v0.18.26 · 出候选 → 弹候选数提示 (与无候选对齐)", async () => {
    interactiveAnnotateMock.mockResolvedValue({
      result: [
        { type: "rectanglelabels", value: { x: 1, y: 1, width: 5, height: 5, rectanglelabels: ["a"] }, score: 0.9 },
        { type: "rectanglelabels", value: { x: 1, y: 1, width: 5, height: 5, rectanglelabels: ["b"] }, score: 0.8 },
      ],
    });
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0.1, 0.1, 0.2, 0.2]));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ msg: "2 个候选", kind: "success" }),
      ),
    );
  });

  it("多连通 mask (value.polygons) → 取面积最大外环, 不丢候选", async () => {
    // 后端多环结构: 一个大三角 (面积 0.5) + 一个碎屑小三角 (面积 ~0.005)。
    interactiveAnnotateMock.mockResolvedValue({
      result: [
        {
          type: "polygonlabels",
          value: {
            polygons: [
              { points: [[0, 0], [0.1, 0], [0, 0.1]] }, // 碎屑
              { points: [[0, 0], [1, 0], [0, 1]] }, // 主体 (最大)
            ],
            polygonlabels: ["object"],
          },
          score: 0.9,
        },
      ],
    });
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runPoint([0.5, 0.5], 1));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    // 取最大外环 (主体三角), 而非碎屑。
    expect(result.current.candidates[0].points).toEqual([[0, 0], [1, 0], [0, 1]]);
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
    act(() => result.current.runBbox([0.1, 0.1, 0.2, 0.2]));
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

  // v0.10.23 · 会话级模型变体切换三态通知
  it("切换变体后首次预测 → 切换中 + 成功 toast", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() =>
      result.current.runBbox([0, 0, 0.5, 0.5], { sam_variant: "large", dino_variant: "base" }),
    );
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(pushToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "正在切换到 SAM large/DINO base 模型…" }),
    );
    expect(pushToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "已切换到 SAM large/DINO base", kind: "success" }),
    );
    expect(interactiveAnnotateMock.mock.calls[0][2].context).toMatchObject({
      model_variants: { sam_variant: "large", dino_variant: "base" },
    });
    expect(interactiveAnnotateMock.mock.calls[0][2].context.sam_variant).toBeUndefined();
    expect(interactiveAnnotateMock.mock.calls[0][2].context.dino_variant).toBeUndefined();
  });

  it("model_variants 响应 cache_hit 真信号写入 variant hot map", async () => {
    interactiveAnnotateMock.mockResolvedValue({ ...POLY_RESPONSE, cache_hit: false });
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() =>
      result.current.runBbox([0, 0, 0.5, 0.5], {
        model_variants: { series: "yolov11", size: "s" },
      }),
    );
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(interactiveAnnotateMock.mock.calls[0][2].context.model_variants).toEqual({
      series: "yolov11",
      size: "s",
    });
    expect(recordPredictCacheHitMock).toHaveBeenCalledWith(
      "b1",
      { series: "yolov11", size: "s" },
      false,
    );
  });

  it("同变体的后续预测不再弹切换 toast", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5], { sam_variant: "large" }));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    pushToastMock.mockClear();
    // 不同 bbox (避开前端缓存) 但同变体 → 不应再弹切换通知
    act(() => result.current.runBbox([0.1, 0.1, 0.6, 0.6], { sam_variant: "large" }));
    await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(2));
    expect(pushToastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining("切换") }),
    );
  });

  it("缺 dino_variant → 文案仅显示 SAM 段", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5], { sam_variant: "tiny" }));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ msg: "已切换到 SAM tiny", kind: "success" }),
      ),
    );
  });

  it("切换变体后预测失败 → 模型切换失败 toast 且 backend detail 透出", async () => {
    interactiveAnnotateMock.mockRejectedValue(new Error("checkpoint not provisioned"));
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5], { sam_variant: "large" }));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "模型切换失败",
          sub: "checkpoint not provisioned",
          kind: "error",
        }),
      ),
    );
  });

  it("503 推理错误 → 显示模型暂不可用与 Retry-After", async () => {
    interactiveAnnotateMock.mockRejectedValue(
      new ApiError(503, "ML backend: model unavailable", undefined, { "retry-after": "30" }),
    );
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "模型暂不可用",
          sub: "30 秒后重试",
          kind: "error",
        }),
      ),
    );
  });

  it("无变体字段的预测不弹任何切换 toast", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(pushToastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining("切换") }),
    );
  });

  it("cancel 清空候选", async () => {
    interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
    const { result } = renderHook(() => useInteractiveAI(ARGS));
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    act(() => result.current.cancel());
    expect(result.current.candidates).toHaveLength(0);
  });

  // claude[bot] P1 回归 · cache-hit-after-inflight: 上一个真实请求 in-flight 时, 紧接着
  // 触发一次命中前端缓存的调用 → 旧请求被 abort + inflightRef 自增, 但 cache 分支直接 return,
  // 旧请求 finally 守卫不通过 → isRunning 卡在 true。修后 cache 分支显式 setIsRunning(false)。
  it("cache 命中且上一个请求 in-flight 时 isRunning 复位 (P1 回归)", async () => {
    // 调用次序: 1) 跑通填 cache → 2) hang 住模拟 in-flight → 3) cache 命中(不再调 mock)。
    interactiveAnnotateMock.mockResolvedValueOnce(POLY_RESPONSE);
    let secondResolve: ((v: typeof POLY_RESPONSE) => void) | undefined;
    interactiveAnnotateMock.mockImplementationOnce(
      () => new Promise((res) => { secondResolve = res as typeof secondResolve; }),
    );

    const { result } = renderHook(() => useInteractiveAI(ARGS));

    // 第 1 次: 同一 bbox 跑通 → 缓存填好。
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.isRunning).toBe(false);

    // 第 2 次: 换 prompt, hang 住 (mockImplementationOnce 走这次)。
    act(() => result.current.runBbox([0.1, 0.1, 0.4, 0.4]));
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    // 第 3 次: 回到第 1 次的 prompt → cache 命中, 在 in-flight 期间触发。
    act(() => result.current.runBbox([0, 0, 0.5, 0.5]));
    // 候选立刻复用 (cache 同步命中); isRunning 必须立刻复位, 不等 in-flight resolve。
    expect(result.current.candidates).toHaveLength(1);
    expect(result.current.isRunning).toBe(false);

    // 收尾: 让 hang 的请求 resolve, 防止泄漏 (旧请求的结果被 inflight 守卫丢弃)。
    secondResolve?.(POLY_RESPONSE);
  });

  // v0.18.19 · exemplar refine 会话 (多正负框 + text 组合 + 阈值重过滤)
  describe("exemplar refine 会话", () => {
    it("runExemplar 累加正/负框, 每次重发全量 exemplars[]", async () => {
      interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
      const { result } = renderHook(() => useInteractiveAI(ARGS));

      act(() => result.current.runExemplar([0.1, 0.1, 0.2, 0.2], 1, "mask"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));
      expect(interactiveAnnotateMock.mock.calls[0][2].context).toMatchObject({
        type: "exemplar",
        exemplars: [{ bbox: [0.1, 0.1, 0.2, 0.2], label: true }],
        output: "mask",
      });

      act(() => result.current.runExemplar([0.5, 0.5, 0.6, 0.6], 0, "mask"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(2));
      // 第二次重发全量 (正框 + 负框)。
      expect(interactiveAnnotateMock.mock.calls[1][2].context.exemplars).toEqual([
        { bbox: [0.1, 0.1, 0.2, 0.2], label: true },
        { bbox: [0.5, 0.5, 0.6, 0.6], label: false },
      ]);
      // 会话框镜像供画布 overlay。
      expect(result.current.sessionExemplars).toEqual([
        { bbox: [0.1, 0.1, 0.2, 0.2], polarity: 1 },
        { bbox: [0.5, 0.5, 0.6, 0.6], polarity: 0 },
      ]);
    });

    it("setExemplarText 会话进行中即重跑, 携带 text 组合", async () => {
      interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
      const { result } = renderHook(() => useInteractiveAI(ARGS));

      act(() => result.current.runExemplar([0.1, 0.1, 0.3, 0.3], 1, "mask"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));

      act(() => result.current.setExemplarText("car"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(2));
      expect(interactiveAnnotateMock.mock.calls[1][2].context).toMatchObject({
        type: "exemplar",
        exemplars: [{ bbox: [0.1, 0.1, 0.3, 0.3], label: true }],
        text: "car",
      });
    });

    it("setExemplarThreshold 会话进行中重过滤, 携带 score_threshold", async () => {
      interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
      const { result } = renderHook(() => useInteractiveAI(ARGS));

      act(() => result.current.runExemplar([0.1, 0.1, 0.3, 0.3], 1, "mask"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));

      act(() => result.current.setExemplarThreshold(0.8));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(2));
      expect(interactiveAnnotateMock.mock.calls[1][2].context.score_threshold).toBe(0.8);
    });

    it("无会话时 setExemplarText/Threshold 不发请求 (仅暂存)", async () => {
      const { result } = renderHook(() => useInteractiveAI(ARGS));
      act(() => result.current.setExemplarText("car"));
      act(() => result.current.setExemplarThreshold(0.7));
      await new Promise((r) => setTimeout(r, 20));
      expect(interactiveAnnotateMock).not.toHaveBeenCalled();
      expect(result.current.exemplarText).toBe("car");
      expect(result.current.exemplarThreshold).toBe(0.7);
    });

    it("rerunExemplar(outputMode) 用当前会话重跑, 透传新 output", async () => {
      interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
      const { result } = renderHook(() => useInteractiveAI(ARGS));
      act(() => result.current.runExemplar([0.1, 0.1, 0.3, 0.3], 1, "mask"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(1));

      act(() => result.current.rerunExemplar("both"));
      await waitFor(() => expect(interactiveAnnotateMock).toHaveBeenCalledTimes(2));
      expect(interactiveAnnotateMock.mock.calls[1][2].context.output).toBe("both");
    });

    it("切到 point/bbox 模式 → 重置 exemplar 会话框", async () => {
      interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
      const { result } = renderHook(() => useInteractiveAI(ARGS));
      act(() => result.current.runExemplar([0.1, 0.1, 0.3, 0.3], 1, "mask"));
      await waitFor(() => expect(result.current.sessionExemplars).toHaveLength(1));
      act(() => result.current.runBbox([0.4, 0.4, 0.6, 0.6]));
      expect(result.current.sessionExemplars).toHaveLength(0);
    });

    it("cancel 清空 exemplar 会话 (框 + text + 阈值)", async () => {
      interactiveAnnotateMock.mockResolvedValue(POLY_RESPONSE);
      const { result } = renderHook(() => useInteractiveAI(ARGS));
      act(() => result.current.runExemplar([0.1, 0.1, 0.3, 0.3], 1, "mask"));
      await waitFor(() => expect(result.current.sessionExemplars).toHaveLength(1));
      act(() => result.current.setExemplarText("car"));
      act(() => result.current.cancel());
      expect(result.current.sessionExemplars).toHaveLength(0);
      expect(result.current.exemplarText).toBe("");
      expect(result.current.exemplarThreshold).toBeNull();
    });
  });
});
