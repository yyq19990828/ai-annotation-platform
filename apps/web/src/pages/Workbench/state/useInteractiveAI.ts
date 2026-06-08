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
 * 三种 prompt 全部走 `POST /projects/{pid}/ml-backends/{bid}/interactive-annotating`：
 *   point  : ctx { type:"point", points:[[x,y]], labels:[1|0] }
 *   bbox   : ctx { type:"bbox",  bbox:[x1,y1,x2,y2] }
 *   text   : ctx { type:"text",  text }
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
  /** v0.10.2 · 各 run* 接受可选 extraParams; 由 AIToolDrawer 注入 (box_threshold 等). */
  runPoint: (pt: [number, number], polarity: 1 | 0, extraParams?: Record<string, unknown>) => void;
  runBbox: (bbox: [number, number, number, number], extraParams?: Record<string, unknown>) => void;
  runText: (text: string, outputMode?: TextOutputMode, extraParams?: Record<string, unknown>) => void;
  /** v0.10.2 · SAM 3 exemplar prompt: 与 bbox 同手势, 但 context.type="exemplar". outputMode 同 text 选 box/mask/both. */
  runExemplar: (
    bbox: [number, number, number, number],
    outputMode?: TextOutputMode,
    extraParams?: Record<string, unknown>,
  ) => void;
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
      const cacheKey = makeSamCacheKey({ taskId, mlBackendId, ctxKind, ctx: requestContext });
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
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        dispatch(
          { ...(extraParams ?? {}), type: "point", points: [pt], labels: [polarity] },
          "point",
        );
      }, DEBOUNCE_MS);
    },
    [guard, dispatch],
  );

  const runBbox = useCallback(
    (bbox: [number, number, number, number], extraParams?: Record<string, unknown>) => {
      if (!guard()) return;
      dispatch({ ...(extraParams ?? {}), type: "bbox", bbox }, "bbox");
    },
    [guard, dispatch],
  );

  const runText = useCallback(
    (text: string, outputMode: TextOutputMode = "mask", extraParams?: Record<string, unknown>) => {
      if (!guard()) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      // v0.9.4 phase 2 · output 字段控制 box/mask/both; 老 backend 缺字段时仍走 mask 兼容.
      dispatch({ ...(extraParams ?? {}), type: "text", text: trimmed, output: outputMode }, "text");
    },
    [guard, dispatch],
  );

  const runExemplar = useCallback(
    (
      bbox: [number, number, number, number],
      outputMode: TextOutputMode = "mask",
      extraParams?: Record<string, unknown>,
    ) => {
      if (!guard()) return;
      // v0.10.2 · 协议 §2.2: type=exemplar 复用 bbox 字段, 语义靠 type 区分.
      // output 字段控制 box/mask/both (对齐 text); 老 backend 缺字段时仍走 mask 兼容.
      dispatch({ ...(extraParams ?? {}), type: "exemplar", bbox, output: outputMode }, "exemplar");
    },
    [guard, dispatch],
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

  const consume = useCallback((idx: number) => {
    setCandidates((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((i) => Math.max(0, i >= idx ? i - 1 : i));
  }, []);

  const cancel = useCallback(() => {
    setCandidates([]);
    setActiveIdx(0);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

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

  // 切 task / backend → 重置预热记忆
  useEffect(() => {
    warmedRef.current = null;
  }, [taskId, mlBackendId]);

  return {
    candidates,
    activeIdx,
    isRunning,
    runPoint,
    runBbox,
    runText,
    runExemplar,
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
  const pts = r?.value?.points;
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
