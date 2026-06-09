/**
 * v0.14.18 · 多 ML Backend 能力路由 (交互线).
 *
 * 一个项目注册多个 backend 时, 工作台 AI 从"单 active 后端驱动一切"改成"按角色 + 能力路由":
 * 交互工具 (point/bbox/exemplar) 各自解析到支持该 prompt 的交互后端, 批量线另走 batchBackendId。
 * 本 hook 只负责交互线: 对每个注册后端拉 /setup 建 capIndex, 产出 isPromptSupported (并集) +
 * resolveInteractive (逐 prompt 确定性解析 + preferred 兜底) + preferred 状态/持久化。
 *
 * 设计见 docs/plans/2026-06-09-v0.14.18-ml-backend-capability-routing.md (§3/§4)。
 * 纯路由逻辑抽成下方独立函数, 便于单测 (capIndex 构建 / resolveInteractive 三情形 / 兜底链 / reachable 降级)。
 */
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { mlBackendsApi, type MLBackendCapability } from "@/api/ml-backends";

/** 交互 prompt 集合 (text 归批量线, 不在此)。 */
export const INTERACTIVE_PROMPTS = ["point", "bbox", "exemplar"] as const;
export type InteractivePrompt = (typeof INTERACTIVE_PROMPTS)[number];

function isInteractivePrompt(p: string): p is InteractivePrompt {
  return (INTERACTIVE_PROMPTS as readonly string[]).includes(p);
}

export interface BackendCapEntry {
  /** 该后端支持的交互 prompt (跨其 model 取并集; 仅 is_interactive 的 model 计入)。 */
  prompts: Set<InteractivePrompt>;
  /** 是否支持文本 prompt (批量线判定用)。 */
  textCapable: boolean;
  /** 后端整体是否交互 (任一 model 或顶层 is_interactive)。 */
  isInteractive: boolean;
  /** 支持的视频 tracker (本期不消费, 仅入索引)。 */
  trackers: string[];
  /** /setup 拉取成功 (false 时从候选排除, 自动降级)。 */
  reachable: boolean;
}

/** 由单个后端的 /setup 响应派生能力条目。reachable=false 表示拉取失败 (cap 为空)。 */
export function buildCapEntry(cap: MLBackendCapability | undefined): BackendCapEntry {
  const prompts = new Set<InteractivePrompt>();
  let textCapable = false;
  let isInteractive = false;
  const trackers = new Set<string>();

  if (!cap) {
    return { prompts, textCapable, isInteractive, trackers: [], reachable: false };
  }

  const models = Array.isArray(cap.models) ? cap.models : [];
  const addPrompts = (interactive: boolean, supported: string[] | undefined) => {
    for (const p of supported ?? []) {
      if (p === "text") textCapable = true;
      if (interactive && isInteractivePrompt(p)) prompts.add(p);
    }
  };

  if (models.length > 0) {
    for (const m of models) {
      const mInteractive = m.is_interactive === true;
      if (mInteractive) isInteractive = true;
      addPrompts(mInteractive, m.supported_prompts);
      for (const t of m.supported_trackers ?? []) trackers.add(t);
    }
  } else {
    // 老式单 model 后端 (sam3 等): 用顶层字段。is_interactive 缺省视为交互 (向后兼容)。
    const topInteractive = cap.is_interactive !== false;
    if (topInteractive) isInteractive = true;
    addPrompts(topInteractive, cap.supported_prompts);
  }
  for (const t of cap.supported_trackers ?? []) trackers.add(t);

  return { prompts, textCapable, isInteractive, trackers: [...trackers], reachable: true };
}

export type CapIndex = Record<string, BackendCapEntry>;

/** reachable 且支持该 prompt 的候选后端 (按注册顺序)。 */
export function candidatesFor(
  capIndex: CapIndex,
  order: string[],
  p: InteractivePrompt,
): string[] {
  return order.filter((id) => {
    const e = capIndex[id];
    return !!e && e.reachable && e.prompts.has(p);
  });
}

/**
 * 逐 prompt 解析交互后端。顺序: preferred → 项目默认 → 注册序第一个。
 * preferred 初值即项目默认 (见 pickDefaultPreferred), 故未切换时等价"项目默认优先";
 * 用户切过后 preferred 覆盖默认 (否则默认本身交互时选择器失效)。
 */
export function resolveInteractive(
  capIndex: CapIndex,
  order: string[],
  defaultBackendId: string | null,
  preferredId: string | null,
  p: InteractivePrompt,
): string | null {
  const cands = candidatesFor(capIndex, order, p);
  if (cands.length === 0) return null;
  if (preferredId && cands.includes(preferredId)) return preferredId;
  if (defaultBackendId && cands.includes(defaultBackendId)) return defaultBackendId;
  return cands[0];
}

/** preferred 初值: 项目默认 (若它是交互后端) 否则第一个交互后端; 都没有 → null。 */
export function pickDefaultPreferred(
  capIndex: CapIndex,
  order: string[],
  defaultBackendId: string | null,
): string | null {
  if (
    defaultBackendId &&
    capIndex[defaultBackendId]?.reachable &&
    capIndex[defaultBackendId].prompts.size > 0
  ) {
    return defaultBackendId;
  }
  return order.find((id) => capIndex[id]?.reachable && capIndex[id].prompts.size > 0) ?? null;
}

function storageKey(userId: string | null | undefined, projectId: string | null | undefined): string {
  return `wb:preferred-interactive:${userId ?? "anon"}:${projectId ?? "none"}`;
}

function readStoredPreferred(
  userId: string | null | undefined,
  projectId: string | null | undefined,
): string | null {
  try {
    return localStorage.getItem(storageKey(userId, projectId));
  } catch {
    return null;
  }
}

function writeStoredPreferred(
  userId: string | null | undefined,
  projectId: string | null | undefined,
  id: string | null,
): void {
  try {
    if (id) localStorage.setItem(storageKey(userId, projectId), id);
    else localStorage.removeItem(storageKey(userId, projectId));
  } catch {
    /* ignore quota / privacy mode */
  }
}

export interface BackendRoutingArgs {
  projectId: string | null | undefined;
  userId: string | null | undefined;
  /** 已注册后端 (注册顺序 = list 返回顺序)。 */
  backends: Array<{ id: string; name: string }>;
  /** 项目默认后端 (ml_backend_id)。 */
  defaultBackendId: string | null;
}

export interface BackendRoutingResult {
  capIndex: CapIndex;
  isLoading: boolean;
  /** 工具栏 AI 工具门控: 某 prompt 只要任一交互后端支持就亮 (text → 任一 textCapable)。 */
  isPromptSupported: (type: string) => boolean;
  /** 解析某交互 prompt 实际会跑的后端 (null = 无候选, 工具置灰)。 */
  resolveInteractive: (p: InteractivePrompt) => string | null;
  /** 某交互 prompt 的候选后端 (按注册序; 选择器只列这些)。 */
  candidatesFor: (p: InteractivePrompt) => string[];
  /** 当前 preferred 交互后端 (用户选定, 缺省 = 项目默认/首个交互)。 */
  preferredInteractiveId: string | null;
  setPreferredInteractiveId: (id: string | null) => void;
}

export function useBackendRouting({
  projectId,
  userId,
  backends,
  defaultBackendId,
}: BackendRoutingArgs): BackendRoutingResult {
  const order = useMemo(() => backends.map((b) => b.id), [backends]);

  const queries = useQueries({
    queries: backends.map((b) => ({
      queryKey: ["ml-backends", projectId, b.id, "setup"],
      queryFn: () => mlBackendsApi.setup(projectId as string, b.id),
      enabled: !!projectId,
      staleTime: 5 * 60 * 1000,
      retry: 0,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  // capIndex: backendId → 能力条目。query 成功用 data, 失败 (isError) → reachable=false。
  // 注: queries 数组与 backends 同序; 用 join 的稳定签名做依赖, 避免每渲染重建。
  const capSignature = queries
    .map((q, i) => `${order[i]}:${q.isError ? "err" : q.data ? "ok" : "pend"}`)
    .join("|");
  const capIndex = useMemo<CapIndex>(() => {
    const idx: CapIndex = {};
    backends.forEach((b, i) => {
      const q = queries[i];
      idx[b.id] = q?.isError ? buildCapEntry(undefined) : buildCapEntry(q?.data);
    });
    return idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capSignature]);

  // preferred: 优先读持久化 (若仍是合法交互候选), 否则按默认规则。
  const [preferredOverride, setPreferredOverride] = useState<string | null>(null);
  useEffect(() => {
    setPreferredOverride(readStoredPreferred(userId, projectId));
  }, [userId, projectId]);

  const fallbackPreferred = useMemo(
    () => pickDefaultPreferred(capIndex, order, defaultBackendId),
    [capIndex, order, defaultBackendId],
  );
  // override 仅当它仍是某 prompt 的合法交互候选时生效, 否则回落默认规则 (后端被删/不可达自愈)。
  const overrideValid =
    !!preferredOverride &&
    !!capIndex[preferredOverride]?.reachable &&
    capIndex[preferredOverride].prompts.size > 0;
  const preferredInteractiveId = overrideValid ? preferredOverride : fallbackPreferred;

  const setPreferredInteractiveId = (id: string | null) => {
    setPreferredOverride(id);
    writeStoredPreferred(userId, projectId, id);
  };

  return {
    capIndex,
    isLoading,
    isPromptSupported: (type: string) => {
      if (isInteractivePrompt(type)) {
        return candidatesFor(capIndex, order, type).length > 0;
      }
      if (type === "text") {
        return order.some((id) => capIndex[id]?.reachable && capIndex[id].textCapable);
      }
      return false;
    },
    resolveInteractive: (p) =>
      resolveInteractive(capIndex, order, defaultBackendId, preferredInteractiveId, p),
    candidatesFor: (p) => candidatesFor(capIndex, order, p),
    preferredInteractiveId,
    setPreferredInteractiveId,
  };
}
