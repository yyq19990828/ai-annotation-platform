/**
 * v0.18.16 · 受限树形流水线 → react-flow 图的纯函数层.
 *
 * stagesGraph ({sid, parentSid}, parentSid="root"=源) 仍是唯一真值; 这里把它派生成 react-flow
 * 的 nodes/edges (分层布局) + 提供编辑期校验 (改父合法性 / 加子门控 / 级联后代 / 深度)。所有函数
 * 与 react-flow 运行时解耦 (只用其 Node/Edge 类型, 编译期擦除), 可在 node 环境单测。
 */

import type { Node, Edge } from "@xyflow/react";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";

export interface StageEntry {
  sid: string;
  parentSid: string;
}

export type StageRole = {
  label: string;
  variant: "accent" | "ai" | "success";
  icon: "box" | "sparkles" | "tag";
};

/** 源 sid (源检测阶段, parentSid 链的根)。 */
export const ROOT_SID = "root";

/** 受限树形最大深度 (源=1, 下游 2/3)。 */
export const MAX_DEPTH = 3;

/** 阶段是否产几何 (可作下游的父): crop-detect / box-seg 产几何, 分类产属性。 */
export function producesGeometry(payload: PipelineStagePayload | null | undefined): boolean {
  const t = payload?.write?.target ?? "attributes";
  return t === "geometry" || t === "intermediate";
}

/** 角色徽标: crop-detect(input.mode=crop)=检测; 其它产几何=分割; 否则=分类。 */
export function roleOf(payload: PipelineStagePayload | null | undefined): StageRole {
  if (producesGeometry(payload)) {
    return payload?.input?.mode === "crop"
      ? { label: "检测", variant: "accent", icon: "box" }
      : { label: "分割", variant: "ai", icon: "sparkles" };
  }
  return { label: "分类", variant: "success", icon: "tag" };
}

/** 节点详情行: 产几何=命名·模型; 分类=带前缀写回键 / 全部属性。 */
export function detailOf(payload: PipelineStagePayload | null | undefined): string {
  if (!payload) return "未就绪";
  if (producesGeometry(payload)) {
    return (payload.label ? `${payload.label} · ` : "") + (payload.model_id ?? "");
  }
  const keys = payload.write?.keys ?? [];
  const prefix = payload.label ? `${payload.label}_` : "";
  return keys.length > 0 ? keys.map((k) => prefix + k).join(", ") : "全部属性";
}

/** 父框类别过滤摘要: "仅 person, car" / "全部框"。 */
export function classFilterText(payload: PipelineStagePayload | null | undefined): string {
  const cf = payload?.parent_class_filter;
  return cf && cf.length > 0 ? `仅 ${cf.join(", ")}` : "全部框";
}

/** ROI / 投递摘要: "裁剪 · pad 0.08" / "整图框提示" / ""。 */
export function roiText(payload: PipelineStagePayload | null | undefined): string {
  const roi = payload?.roi;
  if (!roi) return "";
  return roi.mode === "crop"
    ? `裁剪${roi.pad != null ? ` · pad ${roi.pad}` : ""}`
    : "整图框提示";
}

/** 变体摘要: "sam_variant=large, ..." / ""。 */
export function variantText(payload: PipelineStagePayload | null | undefined): string {
  const v = payload?.model_variants;
  if (!v) return "";
  return Object.entries(v)
    .map(([k, val]) => `${k}=${val}`)
    .join(", ");
}

/** 阶段模型能力旗标 (StageCard 自报, 供画布作可达性 / 产属性警示)。 */
export interface StageCaps {
  /** capabilities 查询已就绪 (否则不判, 免误报)。 */
  hasCapabilities: boolean;
  /** 选中 model 自报了 supported_inputs (老 backend 缺省时为 false, 跳过可达性判)。 */
  knownInputs: boolean;
  acceptsCrop: boolean;
  acceptsBboxPrompt: boolean;
  producesAttributes: boolean;
  /**
   * v0.19.2 WS1 · 选中 model 是否产类别属性 (output_attribute_types 含 "class")。
   * undefined = model 未自报属性类型 (无法判, 不警示); false = 自报了但不含 class。
   */
  producesClass?: boolean;
  /**
   * v0.19.3 WS2 · 选中 model 是否可批量 (resource_profile.batchable)。
   * undefined = 未自报 (老 backend, 不警示); false = 自报交互/有状态, 不能进批量预标。
   */
  batchable?: boolean;
}

/**
 * 节点警示文案 (标红, 不硬拦运行 —— 与端点 422 同判据, 仅前移到画布)。
 * - 模型自报 batchable=false (交互/有状态) → 不能进批量预标 (端点 422, WS2)。
 * - 产几何的子既不接 crop 也不接 bbox_prompt → 不可达 (端点会 422)。
 * - 分类子但所选 model 自报属性类型却不含 class → 属性恒空 (端点 422, WS1/WS2)。
 * - 分类子但后端不产属性 → 属性恒空。
 * 返回 null = 无警示。
 */
export function stageWarning(
  payload: PipelineStagePayload | null | undefined,
  caps: StageCaps | null | undefined,
): string | null {
  if (!payload || !caps || !caps.hasCapabilities) return null;
  // batchable 对源/下游均适用, 优先判 (与端点 _assert_capabilities 先判 batchable 对称)。
  if (caps.batchable === false)
    return "该模型为交互/有状态模型（batchable=false），不能用于批量预标流水线";
  if (producesGeometry(payload)) {
    if (caps.knownInputs && !caps.acceptsCrop && !caps.acceptsBboxPrompt)
      return "该模型不接受裁剪图 / 框提示，无法作几何下游（运行将被端点拒绝）";
    return null;
  }
  if (caps.producesClass === false)
    return "该模型不产类别属性（output_attribute_types 不含 class），作分类下游属性恒空";
  if (!caps.producesAttributes)
    return "该后端不自报输出属性，作下游分类只会重新检测、属性恒空";
  return null;
}

/**
 * 每 sid 深度 (root=1, 子=父+1)。
 * 顺父链递归求值, **与数组顺序无关** —— 改父后子可能排在新父之前, 不能假设父先于子出现
 * (否则深度被低估 → canAddChild 误判 → 造出 depth>3)。带环兜底。
 */
export function depthBySid(graph: StageEntry[]): Record<string, number> {
  const parentOf: Record<string, string> = {};
  for (const e of graph) parentOf[e.sid] = e.parentSid;
  const memo: Record<string, number> = { [ROOT_SID]: 1 };
  const depthOf = (sid: string, seen: Set<string>): number => {
    if (memo[sid] != null) return memo[sid];
    const p = parentOf[sid];
    if (p == null || seen.has(sid)) return (memo[sid] = 1); // 孤儿 / 环 → 兜底为 1
    seen.add(sid);
    return (memo[sid] = depthOf(p, seen) + 1);
  };
  for (const e of graph) depthOf(e.sid, new Set());
  return memo;
}

/** sid 的全部后代 (不含自身)。用于级联删 + 环检测。 */
export function descendantsOf(graph: StageEntry[], sid: string): Set<string> {
  const dead = new Set<string>();
  const queue = [sid];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const e of graph) {
      if (e.parentSid === cur && !dead.has(e.sid)) {
        dead.add(e.sid);
        queue.push(e.sid);
      }
    }
  }
  return dead;
}

/** 子树高度 (叶=1, 含 sid 自身那一层): 1 + max(子高度)。 */
export function subtreeHeight(graph: StageEntry[], sid: string): number {
  const kids = graph.filter((e) => e.parentSid === sid);
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map((e) => subtreeHeight(graph, e.sid)));
}

/** sid (含合成 root) 是否产几何 —— 源恒产几何 (检测器)。 */
function sidProducesGeometry(
  payloadBySid: Record<string, PipelineStagePayload | null>,
  sid: string,
): boolean {
  if (sid === ROOT_SID) return true;
  return producesGeometry(payloadBySid[sid]);
}

/** 能否在 parentSid 下加子: 父产几何 + 深度 < MAX_DEPTH (加完子深度 ≤ MAX_DEPTH)。 */
export function canAddChild(
  graph: StageEntry[],
  payloadBySid: Record<string, PipelineStagePayload | null>,
  parentSid: string,
): boolean {
  if (!sidProducesGeometry(payloadBySid, parentSid)) return false;
  return (depthBySid(graph)[parentSid] ?? 1) < MAX_DEPTH;
}

export interface ReparentCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 把 childSid 改挂到 newParentSid 是否合法 (把 0.18.15 受限树形 gating 反向约束进 DAG):
 * 1. 不自连 / 不连回原父 (无意义)。
 * 2. 无环: newParent 不能是 child 的后代。
 * 3. 父产几何 (源恒产几何)。
 * 4. 改父后整子树深度 ≤ MAX_DEPTH。
 * 单父由树模型天然保证 (改父=替换入边)。
 * 子侧 supported_inputs 可达性不在此判 —— 由端点 422 兜底 (与 0.18.15 一致)。
 */
export function canReparent(
  graph: StageEntry[],
  payloadBySid: Record<string, PipelineStagePayload | null>,
  childSid: string,
  newParentSid: string,
): ReparentCheck {
  if (childSid === ROOT_SID) return { ok: false, reason: "源阶段不可改父" };
  if (newParentSid === childSid) return { ok: false, reason: "不能连到自身" };
  const cur = graph.find((e) => e.sid === childSid);
  if (cur && cur.parentSid === newParentSid) return { ok: false, reason: "已是当前父阶段" };
  if (descendantsOf(graph, childSid).has(newParentSid))
    return { ok: false, reason: "不能连到自己的后代（成环）" };
  if (!sidProducesGeometry(payloadBySid, newParentSid))
    return { ok: false, reason: "父阶段须产几何（检测/分割）" };
  const newChildDepth = (depthBySid(graph)[newParentSid] ?? 1) + 1;
  if (newChildDepth + subtreeHeight(graph, childSid) - 1 > MAX_DEPTH)
    return { ok: false, reason: `改父后将超过最大 ${MAX_DEPTH} 层` };
  return { ok: true };
}

/** 应用改父: 返回新 stagesGraph (childSid.parentSid = newParentSid), 校验交给调用方。 */
export function reparent(graph: StageEntry[], childSid: string, newParentSid: string): StageEntry[] {
  return graph.map((e) => (e.sid === childSid ? { ...e, parentSid: newParentSid } : e));
}

// ── 布局 + react-flow 派生 ─────────────────────────────────────────────

/** buildFlow 的输入: 每节点的展示模型 (含合成源节点, sid=ROOT_SID)。 */
export interface GraphNodeModel {
  sid: string;
  parentSid: string | null;
  kind: "source" | "stage";
  role: StageRole;
  detail: string;
  runState: "pending" | "running" | "done";
  /** 迷你计数 (下游: 目标/成功; 源: detected 走 ok 槽)。 */
  targeted?: number;
  ok?: number;
  producesGeometry: boolean;
  canAddChild: boolean;
  conflict: boolean;
  // ── v0.18.16 §13 信息增强 ──
  /** backend 名 (副标题); 看不出用哪个后端是主要痛点。 */
  backendName?: string;
  /** 已配置就绪 (payload != null); 否则节点显「待配置」虚线。 */
  ready: boolean;
  /** 警示文案 (标红 + tooltip), null=无。 */
  warning?: string | null;
  /** 父框过滤摘要 (节点芯片): "仅 person" / "全部框"。 */
  classFilter?: string;
  // 以下仅 hover 浮层显示:
  modelId?: string;
  taskType?: string;
  roiInfo?: string;
  variantInfo?: string;
}

export interface StageNodeData extends GraphNodeModel {
  selected: boolean;
  [key: string]: unknown;
}

const COL_W = 230;
const ROW_H = 116;

/**
 * 分层布局 + react-flow 派生: col = depth-1, 同列内按 DFS 出现序排行。
 * nodes/edges 为受控派生 (位置由算法定, nodesDraggable=false 防漂移)。
 */
export function buildFlow(
  models: GraphNodeModel[],
  selectedSid: string | null,
): { nodes: Node<StageNodeData>[]; edges: Edge[] } {
  const bySid = new Map(models.map((m) => [m.sid, m]));
  const depth: Record<string, number> = {};
  // seen 防护: 即便上游漏过了环 / 超深图, 也不让递归打爆栈 (画布崩溃)。
  const computeDepth = (sid: string, seen: Set<string>): number => {
    if (depth[sid] != null) return depth[sid];
    const m = bySid.get(sid);
    const p = m?.parentSid;
    if (p == null || seen.has(sid)) return (depth[sid] = 1);
    seen.add(sid);
    return (depth[sid] = computeDepth(p, seen) + 1);
  };
  models.forEach((m) => computeDepth(m.sid, new Set()));

  // DFS 从源出发, 给每列分配递增 row, 保证兄弟稳定纵向排布。
  const rowInCol: Record<number, number> = {};
  const yBySid: Record<string, number> = {};
  const childrenOf = (sid: string | null) => models.filter((m) => m.parentSid === sid);
  const visit = (m: GraphNodeModel) => {
    const col = depth[m.sid] - 1;
    rowInCol[col] = rowInCol[col] ?? 0;
    yBySid[m.sid] = rowInCol[col] * ROW_H;
    rowInCol[col] += 1;
    childrenOf(m.sid).forEach(visit);
  };
  const roots = models.filter((m) => m.parentSid == null);
  roots.forEach(visit);

  const nodes: Node<StageNodeData>[] = models.map((m) => ({
    id: m.sid,
    type: m.kind === "source" ? "source" : "stage",
    position: { x: (depth[m.sid] - 1) * COL_W, y: yBySid[m.sid] ?? 0 },
    data: { ...m, selected: m.sid === selectedSid },
    selected: m.sid === selectedSid,
    draggable: false,
  }));

  const edges: Edge[] = models
    .filter((m) => m.parentSid != null)
    .map((m) => ({
      id: `${m.parentSid}->${m.sid}`,
      source: m.parentSid as string,
      target: m.sid,
      type: "smoothstep",
      reconnectable: true,
    }));

  return { nodes, edges };
}
