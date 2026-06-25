import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { mlBackendsApi } from "@/api/ml-backends";
import { useToastStore } from "@/components/ui/Toast";
import { VARIANT_FIELD_KEYS } from "../components/SchemaForm";
import { recordPredictCacheHit } from "./sessionVariantCache";
import { createSamCache, makeSamCacheKey } from "./useSamCache";

/**
 * v0.9.2 · 工作台 SAM 交互式 hook。
 *
 * 各 prompt 全部走 `POST /projects/{pid}/ml-backends/{bid}/interactive-annotating`：
 *   point           : ctx { type:"point", points:[[x,y],...], labels:[1|0,...], multimask_output }
 *                     (v0.18.17 · 正/负点累加, 每次重发全量点; 首点 multimask 出候选)
 *   interactive_box : ctx { type:"interactive_box", bbox:[x1,y1,x2,y2] } (v0.18.17 · 旧 "bbox" 改名)
 *   text            : ctx { type:"text",  text }
 *   exemplar        : ctx { type:"exemplar", bbox:[x1,y1,x2,y2] } (SAM 3 PCS 全图相似)
 * 后端返回 `result[]`，每条形如：
 *   { type:"polygonlabels", value:{ points:[[x,y]...], polygonlabels:[label] }, score }
 *
 * 候选以「待确认紫虚线」叠加到 Konva canvas，由 `<PendingPolygonsOverlay>` 消费。
 *
 * 防抖：runPoint 80ms（轻击 / 多点同图场景）；runBbox / runText 不防抖（一次完整动作）。
 */
/** v0.9.4 phase 2 · text 模式输出形态. point/bbox 模式恒为 "mask"(协议默认). */
export type TextOutputMode = "box" | "mask" | "both";

export interface PendingCandidate {
  /** 仅用于 React key / 选中态定位 */
  id: string;
  /**
   * v0.9.4 phase 2 · 候选几何类型 discriminator (与后端 AnnotationResult.type 同源).
   * polygonlabels: SAM mask → polygon, 紫虚线多边形渲染.
   * rectanglelabels: DINO 直出 box, 紫虚线矩形渲染.
   * both 模式下同 instance 会出现一对 polygonlabels + rectanglelabels.
   */
  type: "polygonlabels" | "rectanglelabels";
  /** 仅 type=polygonlabels 时有: 归一化顶点列表 [[0..1, 0..1]...] */
  points?: [number, number][];
  /** 仅 type=rectanglelabels 时有: 归一化矩形 (左上 + 宽高, 全部 [0,1]) */
  bbox?: { x: number; y: number; width: number; height: number };
  /** backend 给的标签（DINO 短语 / SAM 默认 "object"） */
  label: string;
  score: number | null;
  /** 触发该候选的 prompt 类型 */
  source: "point" | "bbox" | "text" | "exemplar";
}

export interface UseInteractiveAIArgs {
  projectId: string | undefined;
  taskId: string | undefined;
  mlBackendId: string | undefined | null;
}

export interface UseInteractiveAIReturn {
  candidates: PendingCandidate[];
  activeIdx: number;
  isRunning: boolean;
  /**
   * v0.18.18 · §5.5 当前点交互会话已落的正/负点 (归一化坐标 + 极性), 供画布 overlay 渲染。
   * 提交 / 取消 / 切 prompt / 切 task·backend 时清空。空数组 = 无进行中的多点精修会话。
   */
  sessionPoints: { pt: [number, number]; polarity: 1 | 0 }[];
  /**
   * v0.18.19 · PCS exemplar refine 会话已落的正/负框 (归一化 xyxy + 极性), 供画布 overlay 渲染。
   * 正框=扩召回 / 负框=排误检; 每次操作重发全量。Esc / 切 prompt / 切 task·backend 时清空。
   */
  sessionExemplars: { bbox: [number, number, number, number]; polarity: 1 | 0 }[];
  /** v0.18.19 · exemplar 会话叠加的 text 概念 (PCS text + 几何组合); 改动即重跑当前会话。 */
  exemplarText: string;
  setExemplarText: (text: string) => void;
  /** v0.18.19 · exemplar 会话 per-request 阈值; null=用 backend 默认。拖动即重过滤当前会话。 */
  exemplarThreshold: number | null;
  setExemplarThreshold: (thr: number | null) => void;
  /** v0.10.2 · 各 run* 接受可选 extraParams; 由 AIToolDrawer 注入 (box_threshold 等). */
  runPoint: (pt: [number, number], polarity: 1 | 0, extraParams?: Record<string, unknown>) => void;
  runBbox: (bbox: [number, number, number, number], extraParams?: Record<string, unknown>) => void;
  runText: (text: string, outputMode?: TextOutputMode, extraParams?: Record<string, unknown>) => void;
  /**
   * v0.18.19 · SAM 3 exemplar refine 会话: 拖框累加到正/负框集 (polarity 1=正 / 0=负), 每次
   * 重发全量 exemplars[] + text + 阈值 + output。与 bbox 同手势, context.type="exemplar"。
   */
  runExemplar: (
    bbox: [number, number, number, number],
    polarity: 1 | 0,
    outputMode?: TextOutputMode,
    extraParams?: Record<string, unknown>,
  ) => void;
  /** v0.18.19 · 不加新框, 用当前会话 (含最新 text/阈值/output) 重跑; outputMode 变更时由 shell 调。 */
  rerunExemplar: (outputMode?: TextOutputMode, extraParams?: Record<string, unknown>) => void;
  cycle: (dir: 1 | -1) => void;
  /** 接受一个候选；调用方拿到 candidate 后落库（创建 polygon annotation），随后调 consume(idx) 清除该条。 */
  consume: (idx: number) => void;
  /** 清空所有候选（Esc） */
  cancel: () => void;
  /**
   * v0.10.4 I6.2 · 异步触发 backend embed 预热 (image encoder + 缓存)。
   * 每个 (taskId, mlBackendId) 仅触发一次；结果丢弃但写入 cache，下次真实点击命中。
   * 用 dummy point @ image center；后端不支持 point (sam3-only exemplar) 时静默忽略错误。
   */
  warmup: () => void;
}

const DEBOUNCE_MS = 80;

export function useInteractiveAI(args: UseInteractiveAIArgs): UseInteractiveAIReturn {
  const { projectId, taskId, mlBackendId } = args;
  const pushToast = useToastStore((s) => s.push);

  const [candidates, setCandidates] = useState<PendingCandidate[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(0);

  // v0.18.17 · 点交互会话: 累加同一对象的正/负点, 每次重发全量点 (无状态后端). 单点首击
  // multimask 出候选; ≥2 点转单 mask 精修. 会话在 提交(consume point 候选) / Esc(cancel) /
  // 切 task·backend / 切 prompt 模式(bbox/text/exemplar) 时重置。
  const pointSessionRef = useRef<{ pt: [number, number]; polarity: 1 | 0 }[]>([]);
  // v0.18.18 · §5.5 会话点位可视化: pointSessionRef 是同步真源 (runPoint 立即读它拼全量点),
  // 这里镜像出可订阅 state 驱动画布 overlay 渲染已落的正/负点。
  const [sessionPoints, setSessionPoints] = useState<{ pt: [number, number]; polarity: 1 | 0 }[]>(
    [],
  );
  // v0.18.18 · §5.4 mask_input 回灌: 存上一轮单 mask 的 256×256 low-res logits (不透明 base64);
  // ≥2 点精修阶段经 context.mask_input 回传, 首点候选阶段 / 切 prompt / 提交 / 取消时失效。
  const maskInputRef = useRef<string | null>(null);
  const resetPointSession = useCallback(() => {
    pointSessionRef.current = [];
    maskInputRef.current = null;
    setSessionPoints([]);
  }, []);

  // v0.18.19 · exemplar refine 会话: 累加同一概念的正/负框, 每次重发全量 (无状态后端). 拖正框
  // 扩召回 / 拖负框去误检 / 拖阈值实时增减 / 叠 text 概念。会话在 Esc(cancel) / 切 task·backend /
  // 切到其它 prompt 模式 (point/bbox/text) 时重置。lastExemplarArgsRef 存上次 dispatch 的
  // outputMode + extra, 供「不加新框」的 text/阈值/output 变更重跑复用。
  const exemplarSessionRef = useRef<
    { bbox: [number, number, number, number]; polarity: 1 | 0 }[]
  >([]);
  const lastExemplarArgsRef = useRef<{
    outputMode: TextOutputMode;
    extra: Record<string, unknown>;
  }>({ outputMode: "mask", extra: {} });
  const [sessionExemplars, setSessionExemplars] = useState<
    { bbox: [number, number, number, number]; polarity: 1 | 0 }[]
  >([]);
  const [exemplarText, setExemplarTextState] = useState("");
  const [exemplarThreshold, setExemplarThresholdState] = useState<number | null>(null);
  // dispatchExemplar 读这两个 ref 拿最新 text/阈值, 避免把它们塞进 useCallback 依赖导致闭包过期。
  const exemplarTextRef = useRef("");
  const exemplarThresholdRef = useRef<number | null>(null);
  const resetExemplarSession = useCallback(() => {
    exemplarSessionRef.current = [];
    exemplarTextRef.current = "";
    exemplarThresholdRef.current = null;
    lastExemplarArgsRef.current = { outputMode: "mask", extra: {} };
    setSessionExemplars([]);
    setExemplarTextState("");
    setExemplarThresholdState(null);
  }, []);

  // v0.10.23 · 会话级模型变体切换反馈。变体切换是惰性的：用户在 AI 面板下拉选了新变体后,
  // 直到下一次预测才把它发给 backend (首次冷启 1-3s+)。lastAppliedVariantRef 记「上次成功
  // 应用的变体签名」, 切换后首次预测期间弹「切换中…→ 成功/失败」三态通知; 同变体后续预测不弹。
  // 切 backend → 清空 (新 backend 的变体语义独立)。
  const lastAppliedVariantRef = useRef<string | null>(null);
  useEffect(() => {
    lastAppliedVariantRef.current = null;
  }, [mlBackendId]);

  // v0.10.4 I6.1 · 按 (taskId, mlBackendId, ctx) 缓存候选；切 backend 时全清。
  const cache = useMemo(() => createSamCache(), []);
  useEffect(() => {
    cache.clearAll();
  }, [mlBackendId, cache]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const guard = useCallback((): boolean => {
    if (!projectId || !taskId) return false;
    if (!mlBackendId) {
      pushToast({
        msg: "项目未绑定 ML Backend",
        sub: "请先在项目设置中绑定 SAM 后端",
        kind: "error",
      });
      return false;
    }
    return true;
  }, [projectId, taskId, mlBackendId, pushToast]);

  const dispatch = useCallback(
    async (context: Record<string, unknown>, source: PendingCandidate["source"]) => {
      if (!projectId || !taskId || !mlBackendId) return;
      const normalized = normalizePredictContext(context);
      const requestContext = normalized.context;
      const ctxKind = (requestContext.type as string | undefined) ?? source;
      // v0.18.18 · mask_input 是上一轮 logits 的不透明回灌, 不进缓存键 (同一点序的 mask_input
      // 是确定的, 排除它避免巨串塞键 / 误判 miss)。
      const { mask_input: _maskInput, ...ctxForKey } = requestContext;
      const cacheKey = makeSamCacheKey({ taskId, mlBackendId, ctxKind, ctx: ctxForKey });
      // 命中前端缓存：直接复用候选，跳过 HTTP。
      const cached = cache.get(cacheKey);
      if (cached) {
        setCandidates(cached);
        setActiveIdx(0);
        return;
      }
      // v0.10.23 · 本次请求携带的变体是否与上次成功应用的不同 → 切换后首次预测, 弹三态通知。
      const variantSig = variantSignature(requestContext);
      const isVariantSwitch =
        variantSig !== null && variantSig !== lastAppliedVariantRef.current;
      if (isVariantSwitch) {
        pushToast({ msg: `正在切换到 ${variantLabel(requestContext)} 模型…` });
      }
      const myInflight = ++inflightRef.current;
      setIsRunning(true);
      try {
        const resp = await mlBackendsApi.interactiveAnnotate(projectId, mlBackendId, {
          task_id: taskId,
          context: requestContext,
        });
        // 只接受最新一次请求的结果（防止防抖窗口外的旧请求覆盖新候选）
        if (myInflight !== inflightRef.current) return;
        // v0.18.18 · 存本轮回灌 token: 单 mask 精修阶段非空, 多候选 / 框 / text / exemplar 为 null
        // (后端按 multimask 自动决定), 下次 ≥2 点点击经 context.mask_input 回传。
        maskInputRef.current = resp.mask_input_next ?? null;
        if (isVariantSwitch) {
          lastAppliedVariantRef.current = variantSig;
          pushToast({ msg: `已切换到 ${variantLabel(requestContext)}`, kind: "success" });
        }
        recordPredictCacheHit(
          mlBackendId,
          normalized.modelVariants,
          Object.keys(normalized.modelVariants).length > 0 ? resp.cache_hit : null,
        );
        const next: PendingCandidate[] = (resp.result ?? [])
          .map((r, i) => normalizeResult(r, i, source))
          .filter((c): c is PendingCandidate => c !== null);
        setCandidates(next);
        setActiveIdx(0);
        // 仅缓存非空结果，避免后端瞬时返空被钉死。
        if (next.length > 0) cache.set(cacheKey, next);
        if (next.length === 0) {
          pushToast({
            msg: "SAM 未返回候选",
            sub: source === "text" ? "请尝试英文 prompt 或调低阈值" : "请尝试不同的位置/区域",
            kind: "warning",
          });
        }
      } catch (err) {
        if (myInflight !== inflightRef.current) return;
        const formatted = formatPredictError(err);
        const msg = err instanceof Error ? err.message : String(err);
        // 切换后首次预测失败 → 不更新 lastAppliedVariant (下次重试仍视为切换), 落到切换失败态;
        // backend 503 (变体 checkpoint 未预置) 的 detail 经 ApiError.message 透出。
        pushToast({
          msg: formatted?.msg ?? (isVariantSwitch ? "模型切换失败" : "SAM 推理失败"),
          sub: formatted?.sub ?? msg.slice(0, 120),
          kind: "error",
        });
      } finally {
        if (myInflight === inflightRef.current) setIsRunning(false);
      }
    },
    [projectId, taskId, mlBackendId, pushToast, cache],
  );

  const runPoint = useCallback(
    (pt: [number, number], polarity: 1 | 0, extraParams?: Record<string, unknown>) => {
      if (!guard()) return;
      // v0.18.19 · 切到点模式 → 重置 exemplar 会话 (互斥)。
      resetExemplarSession();
      // v0.18.17 · 累加到当前点会话, 每次重发全量点 (正/负点精修同一对象).
      pointSessionRef.current = [...pointSessionRef.current, { pt, polarity }];
      const session = pointSessionRef.current;
      // v0.18.18 · §5.5 镜像到可订阅 state, 驱动画布会话点 overlay。
      setSessionPoints(session);
      const points = session.map((s) => s.pt);
      const labels = session.map((s) => s.polarity);
      // 单点首击 multimask 出 3 候选 (top-1 + Tab 切换); 累加 ≥2 点转单 mask 精修.
      const multimask = session.length === 1;
      // v0.18.18 · §5.4 仅多点精修阶段 (≥2 点) 回灌上一轮 low-res logits; 首点候选阶段不回灌
      // (多候选 index 歧义)。首个非候选点 (第 2 点) 时 maskInputRef 通常还空 (首点是 multimask),
      // 回灌自然从第 3 点起生效, 与协议约定一致。
      const refeed = !multimask && maskInputRef.current ? maskInputRef.current : undefined;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        dispatch(
          {
            ...(extraParams ?? {}),
            type: "point",
            points,
            labels,
            multimask_output: multimask,
            ...(refeed ? { mask_input: refeed } : {}),
          },
          "point",
        );
      }, DEBOUNCE_MS);
    },
    [guard, dispatch, resetExemplarSession],
  );

  const runBbox = useCallback(
    (bbox: [number, number, number, number], extraParams?: Record<string, unknown>) => {
      if (!guard()) return;
      // v0.18.17 · 切到框模式 → 重置点会话; type=interactive_box (旧 "bbox" 退役).
      // 单框默认单 mask (multimask_output 缺省 false, 保留旧 bbox 行为).
      resetPointSession();
      resetExemplarSession();
      dispatch(
        { ...(extraParams ?? {}), type: "interactive_box", bbox, multimask_output: false },
        "bbox",
      );
    },
    [guard, dispatch, resetPointSession, resetExemplarSession],
  );

  const runText = useCallback(
    (text: string, outputMode: TextOutputMode = "mask", extraParams?: Record<string, unknown>) => {
      if (!guard()) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      resetPointSession();
      resetExemplarSession();
      // v0.9.4 phase 2 · output 字段控制 box/mask/both; 老 backend 缺字段时仍走 mask 兼容.
      dispatch({ ...(extraParams ?? {}), type: "text", text: trimmed, output: outputMode }, "text");
    },
    [guard, dispatch, resetPointSession, resetExemplarSession],
  );

  // v0.18.19 · 用当前会话 (全量正/负框 + text + 阈值) 重发一次 exemplar 请求 (无状态后端).
  // outputMode / extra 取自 lastExemplarArgsRef (上次 run/rerun 写入); text/阈值取自 ref 实时值。
  const dispatchExemplar = useCallback(() => {
    const session = exemplarSessionRef.current;
    if (session.length === 0) return;
    const { outputMode, extra } = lastExemplarArgsRef.current;
    const exemplars = session.map((s) => ({ bbox: s.bbox, label: s.polarity === 1 }));
    const text = exemplarTextRef.current.trim();
    const thr = exemplarThresholdRef.current;
    dispatch(
      {
        ...extra,
        type: "exemplar",
        exemplars,
        output: outputMode,
        ...(text ? { text } : {}),
        ...(thr != null ? { score_threshold: thr } : {}),
      },
      "exemplar",
    );
  }, [dispatch]);

  const runExemplar = useCallback(
    (
      bbox: [number, number, number, number],
      polarity: 1 | 0,
      outputMode: TextOutputMode = "mask",
      extraParams?: Record<string, unknown>,
    ) => {
      if (!guard()) return;
      // v0.18.19 · 切到 exemplar 模式 → 重置点会话; 拖框累加到正/负框集, 每次重发全量。
      resetPointSession();
      exemplarSessionRef.current = [...exemplarSessionRef.current, { bbox, polarity }];
      setSessionExemplars(exemplarSessionRef.current);
      lastExemplarArgsRef.current = { outputMode, extra: extraParams ?? {} };
      dispatchExemplar();
    },
    [guard, resetPointSession, dispatchExemplar],
  );

  const rerunExemplar = useCallback(
    (outputMode?: TextOutputMode, extraParams?: Record<string, unknown>) => {
      if (!guard()) return;
      if (exemplarSessionRef.current.length === 0) return;
      lastExemplarArgsRef.current = {
        outputMode: outputMode ?? lastExemplarArgsRef.current.outputMode,
        extra: extraParams ?? lastExemplarArgsRef.current.extra,
      };
      dispatchExemplar();
    },
    [guard, dispatchExemplar],
  );

  const setExemplarText = useCallback(
    (text: string) => {
      exemplarTextRef.current = text;
      setExemplarTextState(text);
      // 会话进行中即重跑 (叠/改 text 概念); 无会话时仅暂存, 下次拖框带上。
      if (exemplarSessionRef.current.length > 0) dispatchExemplar();
    },
    [dispatchExemplar],
  );

  const setExemplarThreshold = useCallback(
    (thr: number | null) => {
      exemplarThresholdRef.current = thr;
      setExemplarThresholdState(thr);
      // 拖阈值实时重过滤 (会话进行中); backbone 缓存命中下只重跑 grounding head。
      if (exemplarSessionRef.current.length > 0) dispatchExemplar();
    },
    [dispatchExemplar],
  );

  const cycleStable = useCallback(
    (dir: 1 | -1) => {
      setActiveIdx((i) => {
        const n = candidates.length;
        if (n === 0) return 0;
        return ((i + dir) % n + n) % n;
      });
    },
    [candidates.length],
  );

  const consume = useCallback(
    (idx: number) => {
      // v0.18.17 · point / interactive_box 的多候选是「同一对象的备选 mask」, 接受一个即
      // 清空全部 + 重置点会话 (开始下一个对象); text / exemplar 是「多实例」, 仅移除被接受的那条.
      const c = candidates[idx];
      if (c && (c.source === "point" || c.source === "bbox")) {
        resetPointSession();
        setCandidates([]);
        setActiveIdx(0);
        return;
      }
      setCandidates((prev) => prev.filter((_, i) => i !== idx));
      setActiveIdx((i) => Math.max(0, i >= idx ? i - 1 : i));
    },
    [candidates, resetPointSession],
  );

  const cancel = useCallback(() => {
    resetPointSession();
    resetExemplarSession();
    setCandidates([]);
    setActiveIdx(0);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [resetPointSession, resetExemplarSession]);

  // v0.10.4 I6.2 · 预热去重：同 (taskId, mlBackendId) 只发一次。
  const warmedRef = useRef<string | null>(null);
  const warmup = useCallback(() => {
    if (!projectId || !taskId || !mlBackendId) return;
    const key = `${taskId}|${mlBackendId}`;
    if (warmedRef.current === key) return;
    warmedRef.current = key;
    // 静默发一个图中心 point，结果丢；只是为了让后端 image encoder 加载 + cache。
    // 用直接 fetch (绕过 dispatch 的 setCandidates / inflightRef)，失败完全静默。
    mlBackendsApi
      .interactiveAnnotate(projectId, mlBackendId, {
        task_id: taskId,
        context: { type: "point", points: [[0.5, 0.5]], labels: [1] },
      })
      .then((resp) => {
        // 预热成功 → 写缓存，下次真实点击命中。
        const ctx = { type: "point", points: [[0.5, 0.5]], labels: [1] };
        const cacheKey = makeSamCacheKey({ taskId, mlBackendId, ctxKind: "point", ctx });
        const next: PendingCandidate[] = (resp.result ?? [])
          .map((r, i) => normalizeResult(r, i, "point"))
          .filter((c): c is PendingCandidate => c !== null);
        if (next.length > 0) cache.set(cacheKey, next);
      })
      .catch(() => {
        // backend 不支持 point (如 sam3 exemplar-only) 或其它失败 → 静默，下次真实点击会重试。
        warmedRef.current = null;
      });
  }, [projectId, taskId, mlBackendId, cache]);

  // 切 task / backend → 重置预热记忆 + 点会话 (含 mask_input 回灌 + 可视化点) + exemplar 会话
  useEffect(() => {
    warmedRef.current = null;
    resetPointSession();
    resetExemplarSession();
  }, [taskId, mlBackendId, resetPointSession, resetExemplarSession]);

  return {
    candidates,
    activeIdx,
    isRunning,
    sessionPoints,
    sessionExemplars,
    exemplarText,
    setExemplarText,
    exemplarThreshold,
    setExemplarThreshold,
    runPoint,
    runBbox,
    runText,
    runExemplar,
    rerunExemplar,
    cycle: cycleStable,
    consume,
    cancel,
    warmup,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * v0.10.23 · 从 context 抽出变体字段 (sam_variant/dino_variant) 拼一个稳定签名,
 * 用于判定「是否切换了变体」。无任何变体字段时返回 null (该 backend 不暴露变体,
 * 或用户从未选过 → 不弹切换通知)。
 */
function variantSignature(context: Record<string, unknown>): string | null {
  const variants = readModelVariants(context);
  const parts = Object.keys(variants)
    .sort()
    .map((key) => `${key}=${variants[key]}`);
  return parts.length > 0 ? parts.join("|") : null;
}

/** v0.10.23 · 通知文案: 「SAM tiny/DINO base」; 其它轴显示 axis=value。 */
function variantLabel(context: Record<string, unknown>): string {
  const variants = readModelVariants(context);
  const sam = variants.sam_variant ?? null;
  const dino = variants.dino_variant ?? null;
  const segs: string[] = [];
  if (sam) segs.push(`SAM ${sam}`);
  if (dino) segs.push(`DINO ${dino}`);
  for (const [key, value] of Object.entries(variants)) {
    if (key === "sam_variant" || key === "dino_variant") continue;
    segs.push(`${key}=${value}`);
  }
  return segs.join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readModelVariants(context: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const nested = context.model_variants;
  if (isRecord(nested)) {
    for (const [key, value] of Object.entries(nested)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  for (const key of VARIANT_FIELD_KEYS) {
    const value = context[key];
    if (typeof value === "string" && out[key] == null) out[key] = value;
  }
  return out;
}

function normalizePredictContext(context: Record<string, unknown>): {
  context: Record<string, unknown>;
  modelVariants: Record<string, string>;
} {
  const modelVariants = readModelVariants(context);
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === "model_variants" || VARIANT_FIELD_KEYS.includes(key as (typeof VARIANT_FIELD_KEYS)[number])) {
      continue;
    }
    next[key] = value;
  }
  if (Object.keys(modelVariants).length > 0) {
    next.model_variants = modelVariants;
  }
  return { context: next, modelVariants };
}

function formatPredictError(err: unknown): { msg: string; sub?: string } | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 422) {
    return { msg: "参数错误，请检查输入", sub: err.message.slice(0, 120) };
  }
  if (err.status === 503) {
    const retryAfter = err.headers?.["retry-after"];
    return {
      msg: "模型暂不可用",
      sub: retryAfter ? `${retryAfter} 秒后重试` : err.message.slice(0, 120),
    };
  }
  if (err.status >= 500) {
    return { msg: "服务异常", sub: `HTTP ${err.status}` };
  }
  return null;
}


interface BackendResult {
  type?: string;
  value?: {
    // polygonlabels 字段
    points?: [number, number][];
    // 后端 _rings_to_polygon_label 在「多连通区域」时改用 polygons[] 承载各外环 (单环时才用 points)。
    polygons?: { points: [number, number][]; holes?: [number, number][][] }[];
    polygonlabels?: string[];
    // rectanglelabels 字段 (v0.9.4 phase 2)
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rectanglelabels?: string[];
  };
  score?: number;
}

function normalizeResult(
  raw: unknown,
  idx: number,
  source: PendingCandidate["source"],
): PendingCandidate | null {
  const r = raw as BackendResult;
  const score = typeof r.score === "number" ? r.score : null;
  const id = `sam-${Date.now()}-${idx}`;

  if (r.type === "rectanglelabels") {
    const v = r.value;
    if (
      !v ||
      typeof v.x !== "number" ||
      typeof v.y !== "number" ||
      typeof v.width !== "number" ||
      typeof v.height !== "number"
    ) {
      return null;
    }
    return {
      id,
      type: "rectanglelabels",
      bbox: { x: v.x, y: v.y, width: v.width, height: v.height },
      label: v.rectanglelabels?.[0] ?? "object",
      score,
      source,
    };
  }

  // 默认 / 显式 polygonlabels
  // 后端按环数分发: 单环 → value.points; 多连通区域 → value.polygons[].points。
  // 候选/预览/落库均为单环模型, 故多环时取「面积最大」外环 (主体), 丢弃碎屑噪点 —
  // 此前只读 value.points, 多环结果被静默丢弃 → "同位置时好时坏 / 没有候选区域"。
  const pts = pickPrimaryRing(r?.value);
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return {
    id,
    type: "polygonlabels",
    points: pts.map(([x, y]) => [x, y]) as [number, number][],
    label: r.value?.polygonlabels?.[0] ?? "object",
    score,
    source,
  };
}

/** 多边形面积 (shoelace 绝对值; 归一化坐标, 仅用于比较取大). */
function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** 单环取 points; 多环 (value.polygons) 取面积最大外环。无有效环返回 null。 */
function pickPrimaryRing(value: BackendResult["value"]): [number, number][] | null {
  if (Array.isArray(value?.points) && value.points.length >= 3) return value.points;
  const polys = value?.polygons;
  if (!Array.isArray(polys) || polys.length === 0) return null;
  let best: [number, number][] | null = null;
  let bestArea = -1;
  for (const p of polys) {
    const ring = p?.points;
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const area = ringArea(ring);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}
