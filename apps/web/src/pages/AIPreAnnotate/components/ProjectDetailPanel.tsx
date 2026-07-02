/**
 * v0.9.12 · BUG B-17 · 项目详情面板 (多选 batch + 串/并行预标 + 已就绪 HistoryTable).
 *
 * 进入条件: ProjectCardGrid 点击某项目卡片;此面板替代主视图渲染.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useMLBackends } from "@/hooks/useMLBackends";
import {
  useTriggerPreannotation,
  usePreannotationProgress,
  type PredictMode,
  type PipelineStagePayload,
  type PipelineStageStat,
} from "@/hooks/usePreannotation";
import { useAsyncJob } from "@/hooks/useAsyncJob";
import type { PreannotateArgs } from "./usePreannotateConfig";
import { adminPreannotateApi } from "@/api/adminPreannotate";
import { HistoryTable } from "./HistoryTable";
import { VideoPreannotateGuide } from "./VideoPreannotateGuide";
import { PredictionImportWizard } from "@/components/predictions/PredictionImportWizard";
import { usePreannotateConfig } from "./usePreannotateConfig";
import { PreannotateConfigForm } from "./PreannotateConfigForm";
import { StageCard } from "./StageCard";
import {
  MAX_DEPTH,
  ROOT_SID,
  canAddChild as pureCanAddChild,
  canReparent,
  classFilterText,
  depthBySid,
  descendantsOf,
  detailOf,
  producesGeometry,
  reparent,
  roiText,
  roleOf,
  stageWarning,
  variantText,
  type GraphNodeModel,
  type StageCaps,
  type StageEntry,
} from "../utils/pipelineGraph";
import styles from "./ProjectDetailPanel.module.css";

// react-flow 经 lazy 隔离: chunk 不进主包, 仅 /ai-pre 详情面板按需加载 (同 App.tsx 惯例)。
const PipelineGraphCanvas = lazy(() => import("./PipelineGraphCanvas"));

// v0.11.24 · 预标幂等模式
const PREDICT_MODE_TABS = ["跳过已预标", "覆盖", "追加"];
const PREDICT_MODE_LABELS: Record<PredictMode, string> = {
  skip_predicted: "跳过已预标",
  overwrite: "覆盖",
  append: "追加",
};
const PREDICT_MODE_BY_LABEL: Record<string, PredictMode> = {
  跳过已预标: "skip_predicted",
  覆盖: "overwrite",
  追加: "append",
};

type ConcurrencyMode = "serial" | "parallel";

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

/**
 * v0.18.1 · 把单节点配置 (PreannotateArgs) 投影成一个 pipeline stage。
 * batch 级字段 (prompt / output_mode / predict_mode) 不进 stage —— 源阶段的 prompt 由顶层请求
 * 承载, 下游阶段吃 crop 不需要 prompt。
 */
function argsToStage(
  args: PreannotateArgs,
  stage: number,
  extra: Partial<PipelineStagePayload> = {},
): PipelineStagePayload {
  return {
    stage,
    ml_backend_id: args.ml_backend_id,
    model_id: args.model_id,
    task_type: args.task_type,
    model_variants: args.model_variants,
    params: args.params,
    class_filter: args.class_filter,
    ...extra,
  };
}

interface Props {
  projectId: string;
  onBack: () => void;
  /** 项目卡片传入的聚合摘要（用于头部 ml_backend chip + 并发上限）；不可省的部分会再用 hooks 拉. */
  summary?: {
    project_name: string;
    project_display_id?: string | null;
    /** v0.10.38 · 媒体维度, 用于按模态分流 (image=文本批量预标 / video=引导卡片). */
    data_type?: string | null;
    ml_backend_id?: string | null;
    ml_backend_name?: string | null;
    ml_backend_state?: string | null;
    ml_backend_max_concurrency?: number | null;
  };
}

export function ProjectDetailPanel({ projectId, onBack, summary }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  // v0.9.13 · 订阅 batch 状态变更, 让"待预标批次"列表实时刷新 (B-15)
  useBatchEventsSocket(projectId);

  const projectQ = useProject(projectId);
  const project = projectQ.data as unknown as
    | {
        type_key?: string;
        data_type?: string | null;
        ml_backend_id?: string | null;
        classes_config?: Record<string, { alias?: string | null }>;
        // v0.18.5 · 项目属性 schema, 多阶段下游卡「写回属性键」多选的回落选项。
        attribute_schema?: { fields?: Array<{ key: string; label?: string }> };
        box_threshold?: number | null;
        text_threshold?: number | null;
        // v0.14.13 · 项目级 variant 偏好 (按 backend_id 分桶), 详见 ProjectOut.default_variants.
        default_variants?: Record<string, Record<string, string>>;
        // v0.18.27 · 项目级「已保存的编排」(方案 A); null/缺 = 未配编排.
        preannotate_pipeline?: PipelineStagePayload[] | null;
      }
    | undefined;
  // v0.18.27 · 项目编排保存 / 清除 (方案 A, 一项目一条)。
  const updateProject = useUpdateProject(projectId);
  const savedPipeline = project?.preannotate_pipeline ?? null;
  const savedStageCount = savedPipeline?.length ?? 0;
  // v0.10.38 · 模态分流: summary 优先 (列表已带), 回落 project 查询.
  const dataType = summary?.data_type ?? project?.data_type ?? "image";

  const backendsQ = useMLBackends(projectId);
  const backends = useMemo(
    () => (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>,
    [backendsQ.data],
  );
  // v0.10.38 · 多 backend 选择: 默认绑定值, 用户可在项目已注册 backend 间切换 (epic 阶段 2).
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);
  const firstBackendId = backends[0]?.id ?? null;
  useEffect(() => {
    // 项目切换 / 列表加载后, 默认选绑定 backend (否则第一个)
    setSelectedBackendId(project?.ml_backend_id ?? firstBackendId);
  }, [projectId, project?.ml_backend_id, firstBackendId]);
  const selectedBackend =
    backends.find((b) => b.id === selectedBackendId) ?? null;
  // claude[bot] P1 #5 · 已保存编排里引用的 backend id 在本项目当前 backends 列表里缺多少 (= 被删/停)。
  // 编排可能跨多个 backend, 集合用 backends.map(b.id); 工作台 popover 入口同步据此禁用。
  const savedPipelineMissingBackendCount = useMemo(() => {
    if (!savedPipeline?.length) return 0;
    const known = new Set(backends.map((b) => b.id));
    const missing = new Set<string>();
    for (const s of savedPipeline) {
      if (s.ml_backend_id && !known.has(s.ml_backend_id)) missing.add(s.ml_backend_id);
    }
    return missing.size;
  }, [savedPipeline, backends]);

  // 预标配置区共享状态 (任务类型 / 几何 task / 类别白名单 / variant / 参数 / prompt / 预设 /
  // 输出形态 / buildArgs); 详见 usePreannotateConfig. 工作台 AI 面板复用同一 hook + PreannotateConfigForm.
  const cfg = usePreannotateConfig({ projectId, backendId: selectedBackendId });

  // v0.18.2 · 多阶段预标注 (路径 B M2): 下游阶段卡列表 (并行兄弟, 单层扇出)。每张卡 (StageCard)
  // 自持一份 usePreannotateConfig + PreannotateConfigForm 实例 —— 共享 hook/组件本身不感知阶段
  // 编排 (红线)。卡片把派生 stage payload 上抛, 容器在运行时组装成 pipeline_stages。
  // v0.18.15 · 受限树形 (max depth 3): 下游阶段为 {sid, parentSid} 列表, parentSid="root"=源阶段。
  // 数组顺序即添加顺序 (子总在父之后追加 → 运行期分配的 stage 号天然满足「父序号 < 子序号」)。
  const [stagesGraph, setStagesGraph] = useState<StageEntry[]>([]);
  // v0.18.16 · DAG 画布选中节点 (右列检查器据此显参数); 默认选源 (ROOT_SID), 始终有一张可编辑。
  const [selectedSid, setSelectedSid] = useState<string>(ROOT_SID);
  const stagePayloadsRef = useRef<Record<string, PipelineStagePayload | null>>({});
  // v0.18.16 §13 · 各卡上抛的能力旗标 (可达性 / 产属性警示)。
  const stageCapsRef = useRef<Record<string, StageCaps | null>>({});
  const [stageTick, setStageTick] = useState(0); // 卡片回报 payload/caps → bump 触发重算
  const onStageChange = useCallback(
    (sid: string, payload: PipelineStagePayload | null) => {
      stagePayloadsRef.current[sid] = payload;
      setStageTick((n) => n + 1);
    },
    [],
  );
  const onStageCaps = useCallback((sid: string, caps: StageCaps | null) => {
    stageCapsRef.current[sid] = caps;
    setStageTick((n) => n + 1);
  }, []);
  const seqRef = useRef(0);
  const addStage = useCallback(
    (parentSid: string) => {
      // 超深兜底: 父已达最大深度则拒绝 (UI 的 canAddChild 正常已挡, 这里防漏)。
      if (parentSid !== ROOT_SID && (depthBySid(stagesGraph)[parentSid] ?? 1) >= MAX_DEPTH) {
        pushToast({ msg: "无法加子阶段", sub: `流水线最深 ${MAX_DEPTH} 层`, kind: "warning" });
        return;
      }
      const sid = `stage-${(seqRef.current += 1)}`;
      setStagesGraph((g) => [...g, { sid, parentSid }]);
      setSelectedSid(sid); // 新建即选中 → 右列直接进该阶段参数。
    },
    [stagesGraph, pushToast],
  );
  const removeStage = useCallback((sid: string) => {
    if (sid === ROOT_SID) return; // 源不可删 (会级联清空整棵树)。
    // 删带后代的节点 → 提示连带删除数 (现状静默级联)。
    const kids = descendantsOf(stagesGraph, sid);
    if (kids.size > 0) {
      pushToast({ msg: "已删除阶段", sub: `连带移除 ${kids.size} 个子阶段` });
    }
    setStagesGraph((g) => {
      // 级联移除该阶段及其全部后代 (父被删, 子无依附)。
      const dead = new Set([sid]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const e of g) {
          if (dead.has(e.parentSid) && !dead.has(e.sid)) {
            dead.add(e.sid);
            changed = true;
          }
        }
      }
      // 选中节点被删 → 回落到源。
      setSelectedSid((cur) => (dead.has(cur) ? ROOT_SID : cur));
      return g.filter((e) => !dead.has(e.sid));
    });
  }, [stagesGraph, pushToast]);

  // v0.18.3 · 运行态可视化: 跑批后轮询最后一个多阶段 job 的 result.pipeline_stages (终态真值)。
  const [lastPipelineJobId, setLastPipelineJobId] = useState<string | null>(null);
  const pipelineJobQ = useAsyncJob(lastPipelineJobId, true);
  const terminalStageStats =
    (pipelineJobQ.data?.result?.pipeline_stages as PipelineStageStat[] | undefined) ?? null;

  // v0.18.6 · 运行态实时化: 订阅项目预标 WS, 拿 worker 跑批中途推的逐阶段累加快照。
  const { progress: liveProgress } = usePreannotationProgress(projectId);

  const batchesQ = useBatches(projectId, "active");
  const batches = (batchesQ.data ?? []) as unknown as Array<{
    id: string;
    display_id: string;
    name: string;
    total_tasks?: number | null;
  }>;

  // pre_annotated 队列 (复用 /admin/preannotate-queue 端点 + 客户端按 project 过滤)
  const queueQ = useQuery({
    queryKey: ["admin", "preannotate-queue"],
    queryFn: () => adminPreannotateApi.queue(50),
    staleTime: 1000 * 30,
  });
  const projectQueue = useMemo(
    () => (queueQ.data?.items ?? []).filter((it) => it.project_id === projectId),
    [queueQ.data, projectId],
  );

  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  // v0.11.24 · 默认跳过已预标 task，避免重复预标叠加重复标注
  const [predictMode, setPredictMode] = useState<PredictMode>("skip_predicted");
  const [concurrency, setConcurrency] = useState<ConcurrencyMode>("serial");
  const [running, setRunning] = useState(false);
  // v0.10.15 · 外部预测导入向导 (COCO / AAP JSON)
  const [importOpen, setImportOpen] = useState(false);

  // v0.18.6 · 逐阶段统计: 运行中用 WS 实时快照, 终态/重连回落 job result (终态真值, 不丢)。
  const liveStageStats = liveProgress?.pipeline_stages ?? null;
  const stagesRunning = running || pipelineJobQ.data?.status === "running";
  const stageStats = liveStageStats ?? terminalStageStats;
  // stage 序号 → 统计, 供各卡按自身 stage 取数。stage 0=源检测; i+1=第 i 张下游卡。
  const stageStatByIndex = useMemo(() => {
    const m = new Map<number, PipelineStageStat>();
    for (const s of stageStats ?? []) m.set(s.stage, s);
    return m;
  }, [stageStats]);
  const sourceDetected = stageStatByIndex.get(0)?.detected;
  // 单卡运行态: 未跑=pending; 跑批中=running; 已出统计且非运行中=done。
  const stageRunState = (si: number): "pending" | "running" | "done" => {
    if (stagesRunning) return "running";
    if (stageStatByIndex.has(si)) return "done";
    return "pending";
  };

  // 项目切换时重置批次选择 + 下游阶段卡 (prompt / outputMode 的重置在 usePreannotateConfig 内).
  useEffect(() => {
    setSelectedBatchIds(new Set());
    setStagesGraph([]);
    setSelectedSid(ROOT_SID);
    stagePayloadsRef.current = {};
    setLastPipelineJobId(null);
    setKeyConflictLastWins(false);
  }, [projectId]);

  const trigger = useTriggerPreannotation(projectId);

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const allSelected = batches.length > 0 && batches.every((b) => selectedBatchIds.has(b.id));
  const toggleAll = () => {
    setSelectedBatchIds((s) => {
      const n = new Set(s);
      if (allSelected) {
        for (const b of batches) n.delete(b.id);
      } else {
        for (const b of batches) n.add(b.id);
      }
      return n;
    });
  };

  // 下游卡的派生 payload (stageTick 变化时重算); 全部就绪才允许跑。按 stagesGraph 顺序。
  const downstreamPayloads = useMemo(
    () => stagesGraph.map((e) => stagePayloadsRef.current[e.sid] ?? null),
    // stagePayloadsRef 是 ref, 卡片回报后靠 stageTick 触发重算 (eslint 看不到这层)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stagesGraph, stageTick],
  );
  const allDownstreamReady = downstreamPayloads.every((p) => p != null);

  // v0.18.16 · sid → 派生 payload (供 DAG 图节点角色 / 改父校验)。
  const payloadBySid = useMemo(() => {
    const m: Record<string, PipelineStagePayload | null> = {};
    stagesGraph.forEach((e, i) => {
      m[e.sid] = downstreamPayloads[i] ?? null;
    });
    return m;
  }, [stagesGraph, downstreamPayloads]);

  // v0.18.5 · 选择器化数据源: 项目类别 (类名) + 项目属性 schema 字段键, 传给 StageCard 多选。
  const projectClasses = useMemo(
    () => Object.keys(project?.classes_config ?? {}),
    [project?.classes_config],
  );
  const projectAttributeKeys = useMemo(
    () => (project?.attribute_schema?.fields ?? []).map((f) => f.key),
    [project?.attribute_schema],
  );

  // v0.20.x · 源阶段「筛完的有效类别」(类名): 源模型类别表 (静态 COCO80 等) ∩ 源类别白名单
  //   (白名单空 = 全类)。下游卡的「父框类别」选项优先取此 (下游只会见到源筛出的框), 取不到回落
  //   projectClasses。注: 仅按源阶段算 (覆盖主流单层 det→下游); 多层父为中间阶段时回落自由文本。
  const sourceEffectiveClasses = useMemo<string[]>(() => {
    const all = cfg.geometricModel?.classes ?? [];
    if (all.length === 0) return [];
    const sel = cfg.selectedClassIdx;
    const picked = sel.size > 0 ? all.filter((c) => sel.has(c.index)) : all;
    return picked.map((c) => c.name);
  }, [cfg.geometricModel, cfg.selectedClassIdx]);

  // v0.18.5 / v0.18.15 · 键冲突配置期预警: 多个 attributes 阶段写同一「最终键」(label 前缀后) → 冲突。
  // 与后端校验对齐 (按 label 加完前缀的最终键去重): hat_color 与 shoe_color 不冲突。
  // 算出冲突的最终键 (供顶部提示) + 每卡命中的原始键集 (供 chip 标红)。
  const conflictInfo = useMemo(() => {
    const counts = new Map<string, number>();
    downstreamPayloads.forEach((p) => {
      if (p?.write?.target !== "attributes") return;
      const prefix = p.label ? `${p.label}_` : "";
      for (const k of p.write.keys ?? []) counts.set(prefix + k, (counts.get(prefix + k) ?? 0) + 1);
    });
    const conflictFinals = new Set(
      Array.from(counts).filter(([, n]) => n >= 2).map(([k]) => k),
    );
    const perCard: Record<string, Set<string>> = {};
    const displayFinals = new Set<string>();
    stagesGraph.forEach((e, i) => {
      const p = downstreamPayloads[i];
      if (p?.write?.target !== "attributes") return;
      const prefix = p.label ? `${p.label}_` : "";
      const set = new Set<string>();
      for (const k of p.write.keys ?? []) {
        if (conflictFinals.has(prefix + k)) {
          set.add(k);
          displayFinals.add(prefix + k);
        }
      }
      if (set.size) perCard[e.sid] = set;
    });
    return { conflictFinals, perCard, displayFinals };
  }, [stagesGraph, downstreamPayloads]);
  const hasKeyConflict = conflictInfo.conflictFinals.size > 0;
  // 键冲突策略: reject (默认, 后端校验期拦) | last_wins (末位覆盖, 用户显式允许)。
  const [keyConflictLastWins, setKeyConflictLastWins] = useState(false);

  // v0.18.16 · DAG 图节点模型 (源 + 各下游): 角色徽标 / 运行态 / 迷你计数 / 可加子 / 键冲突。
  // 下游须用不同于检测的 backend → 加子额外要求项目已启用 backend 数>=2 (与原 canHaveChild 一致)。
  // backends 读 GET /projects/{id}/ml-backends, ADR-0044 后该端点只返回项目「已启用」集合。
  const canAddBackend = backends.length >= 2;
  const graphNodes = useMemo<GraphNodeModel[]>(() => {
    const nameOf = (id?: string | null) =>
      id ? (backends.find((b) => b.id === id)?.name ?? undefined) : undefined;
    const source: GraphNodeModel = {
      sid: ROOT_SID,
      parentSid: null,
      kind: "source",
      role: { label: "检测", variant: "accent", icon: "box" },
      // 源「产物」= 检测框 (不是后端名; 后端已在副标题)。
      detail: "检测框",
      runState: stageRunState(0),
      ok: sourceDetected ?? undefined,
      producesGeometry: true,
      canAddChild: canAddBackend && pureCanAddChild(stagesGraph, payloadBySid, ROOT_SID),
      conflict: false,
      ready: cfg.configReady,
      backendName: selectedBackend?.name,
      modelId: cfg.primaryModel?.id,
      taskType: cfg.primaryModel?.task,
      warning: null,
    };
    const stages = stagesGraph.map<GraphNodeModel>((e, i) => {
      const p = downstreamPayloads[i];
      const stat = stageStatByIndex.get(i + 1);
      return {
        sid: e.sid,
        parentSid: e.parentSid,
        kind: "stage",
        role: roleOf(p),
        detail: detailOf(p),
        runState: stageRunState(i + 1),
        targeted: stat?.targeted,
        ok: stat?.ok,
        producesGeometry: producesGeometry(p),
        canAddChild: canAddBackend && pureCanAddChild(stagesGraph, payloadBySid, e.sid),
        conflict: (conflictInfo.perCard[e.sid]?.size ?? 0) > 0,
        ready: p != null,
        backendName: nameOf(p?.ml_backend_id),
        warning: stageWarning(p, stageCapsRef.current[e.sid]),
        classFilter: classFilterText(p),
        modelId: p?.model_id,
        taskType: p?.task_type,
        roiInfo: roiText(p),
        variantInfo: variantText(p),
      };
    });
    return [source, ...stages];
    // stageRunState 每渲染重建 (依赖 stagesRunning/统计); stageCapsRef 是 ref, 靠 stageTick 触发重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stagesGraph,
    downstreamPayloads,
    payloadBySid,
    stageStatByIndex,
    stagesRunning,
    sourceDetected,
    selectedBackend?.name,
    canAddBackend,
    conflictInfo,
    cfg.configReady,
    cfg.primaryModel?.id,
    cfg.primaryModel?.task,
    backends,
    stageTick,
  ]);

  // v0.18.16 · 改父校验 (连线 source=新父, target=子) + 提交。受限规则全在 canReparent 纯函数。
  const canReparentConn = useCallback(
    (childSid: string, newParentSid: string) =>
      canReparent(stagesGraph, payloadBySid, childSid, newParentSid).ok,
    [stagesGraph, payloadBySid],
  );
  const onReparent = useCallback(
    (childSid: string, newParentSid: string) => {
      const chk = canReparent(stagesGraph, payloadBySid, childSid, newParentSid);
      if (!chk.ok) {
        if (chk.reason) pushToast({ msg: "无法改父", sub: chk.reason, kind: "warning" });
        return;
      }
      setStagesGraph((g) => reparent(g, childSid, newParentSid));
      setSelectedSid(childSid);
    },
    [stagesGraph, payloadBySid, pushToast],
  );

  // 配置层就绪 (源 cfg.configReady) && 下游卡 (若有) 全就绪 && 选了批次 && 不在跑 &&
  // (无键冲突 || 已选末位覆盖)。
  const canRun =
    cfg.configReady &&
    (stagesGraph.length === 0 || allDownstreamReady) &&
    selectedBatchIds.size > 0 &&
    !running &&
    (!hasKeyConflict || keyConflictLastWins);

  // v0.18.2 · 有下游阶段卡且全就绪 → 组装 pipeline_stages (源 + N 个并行兄弟 classify)。
  // 源阶段 ml_backend_id 须等于顶层 (baseArgs.ml_backend_id), 后端据此复用既有 backend 校验。
  // 单阶段 (无下游卡) 返回 undefined: onRun 据此走单阶段执行 (向后兼容); 保存编排时另行兜成
  // 单元素数组 (见 onSavePipeline)。两处共用本函数, 避免拼装逻辑分叉 (plan §7 风险)。
  const buildDownstreamStages = (
    baseArgs: PreannotateArgs,
  ): PipelineStagePayload[] | undefined => {
    if (stagesGraph.length === 0 || !allDownstreamReady) return undefined;
    // sid → stage 号: 源="root"=0, 下游按 stagesGraph 顺序 1..N (父总在前 → 父号 < 子号)。
    const numberBySid: Record<string, number> = { root: 0 };
    stagesGraph.forEach((e, i) => {
      numberBySid[e.sid] = i + 1;
    });
    return [
      argsToStage(baseArgs, 0),
      ...stagesGraph.map((e, i) => ({
        ...(downstreamPayloads[i] as PipelineStagePayload),
        stage: i + 1,
        parent_stage: numberBySid[e.parentSid],
      })),
    ];
  };

  // v0.18.27 · 保存当前配置为「项目编排」(方案 A, 一项目一条)。单阶段也存成单元素数组,
  // 保持「一项目一编排」语义; v0.18.28 popover 据此对当前图跑完整链。本版只存不跑。
  const onSavePipeline = () => {
    const baseArgs = cfg.buildArgs(predictMode);
    if (!baseArgs) {
      pushToast({ msg: "配置未就绪", sub: "请先选模型 / 配齐参数", kind: "warning" });
      return;
    }
    if (stagesGraph.length > 0 && !allDownstreamReady) {
      pushToast({ msg: "下游阶段未就绪", sub: "请配齐各阶段卡", kind: "warning" });
      return;
    }
    const stages = buildDownstreamStages(baseArgs) ?? [argsToStage(baseArgs, 0)];
    updateProject.mutate(
      { preannotate_pipeline: stages },
      {
        onSuccess: () =>
          pushToast({
            msg: "已保存为项目编排",
            sub: `${stages.length} 阶段`,
            kind: "success",
          }),
        onError: (e) =>
          pushToast({
            msg: "保存项目编排失败",
            sub: (e as Error).message,
            kind: "warning",
          }),
      },
    );
  };

  const onClearPipeline = () => {
    updateProject.mutate(
      { preannotate_pipeline: null },
      {
        onSuccess: () => pushToast({ msg: "已清除项目编排", kind: "success" }),
        onError: (e) =>
          pushToast({
            msg: "清除项目编排失败",
            sub: (e as Error).message,
            kind: "warning",
          }),
      },
    );
  };

  const onRun = async () => {
    const baseArgs = cfg.buildArgs(predictMode);
    if (!baseArgs || selectedBatchIds.size === 0) return;
    const pipelineStages = buildDownstreamStages(baseArgs);
    if (stagesGraph.length > 0 && !pipelineStages) return;
    const ids = Array.from(selectedBatchIds);
    setRunning(true);
    try {
      let okCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      const firedJobIds: string[] = [];
      const pipelineWarnings = new Set<string>();
      const fireOne = async (bid: string) => {
        try {
          const resp = await trigger.mutateAsync({
            ...baseArgs,
            batch_id: bid,
            ...(pipelineStages
              ? {
                  pipeline_stages: pipelineStages,
                  on_key_conflict: keyConflictLastWins ? "last_wins" : "reject",
                }
              : {}),
          });
          if (resp?.job_id) firedJobIds.push(resp.job_id);
          for (const w of resp?.warnings ?? []) pipelineWarnings.add(w);
          okCount += 1;
        } catch (err) {
          failCount += 1;
          errors.push(`${bid.slice(0, 8)}: ${(err as Error).message}`);
        }
      };
      if (concurrency === "serial") {
        for (const bid of ids) {
          await fireOne(bid);
        }
      } else {
        await Promise.all(ids.map(fireOne));
      }
      pushToast({
        msg: `${concurrency === "serial" ? "串行" : "并行"} 预标已分发`,
        sub: `${okCount} 成功 · ${failCount} 失败`,
        kind: failCount > 0 ? "warning" : "success",
      });
      // v0.20.21 · 派发期软提示 (如 output=both + 多阶段致下游重复处理), 去重后逐条弹出。
      for (const w of pipelineWarnings) {
        pushToast({ msg: w, kind: "warning" });
      }
      if (failCount > 0 && errors.length > 0) {
        console.warn("[ai-pre] 多批次预标部分失败:", errors);
      }
      if (okCount > 0) {
        setSelectedBatchIds(new Set());
        // v0.14.13 · 至少一批成功 → 记 variant 已热 (异步 trigger 拿不到 cache_hit, 走兜底).
        cfg.markHot();
        // v0.18.3 · 多阶段时盯最后一个 job 的逐阶段统计 (单阶段无 pipeline_stages, 不显示)。
        if (pipelineStages && firedJobIds.length > 0) {
          setLastPipelineJobId(firedJobIds[firedJobIds.length - 1]);
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const headerName = summary?.project_name ?? `项目 ${projectId.slice(0, 8)}`;

  // v0.10.38 · 模态分流: 视频项目无批量文本预标语义 (AI 预标在工作台逐轨迹 Shift+T 发起),
  // 渲染引导卡片 + job 历史链接, 不误用图像批量面板 (epic 阶段 2).
  if (dataType === "video") {
    return (
      <VideoPreannotateGuide
        projectId={projectId}
        projectName={headerName}
        displayId={summary?.project_display_id}
        onBack={onBack}
      />
    );
  }
  if (dataType === "lidar") {
    return (
      <div className={styles.root}>
        <div className={styles.header}>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <Icon name="chevLeft" size={11} /> 返回项目列表
          </Button>
          <h2 className={styles.title}>{headerName}</h2>
        </div>
        <Card>
          <div className={styles.mutedText}>点云（lidar）项目暂不支持 AI 预标。</div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon name="chevLeft" size={11} /> 返回项目列表
        </Button>
        <h2 className={styles.title}>{headerName}</h2>
        {summary?.project_display_id && (
          <span className={styles.displayId}>
            ({summary.project_display_id})
          </span>
        )}
        {selectedBackend ? (
          <Badge variant="ai">{selectedBackend.name}</Badge>
        ) : (
          <Badge variant="warning">未绑定 ML backend</Badge>
        )}
        {summary?.ml_backend_max_concurrency != null && (
          <span className={styles.backendLimit}>
            最多 {summary.ml_backend_max_concurrency} 并发
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/ai-pre/jobs?project_id=${projectId}`)}
          title="该项目所有 prediction job 历史"
        >
          <Icon name="history" size={11} /> 历史 job
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setImportOpen(true)}
          title="上传 COCO / AAP JSON 把外部模型预测灌进本项目"
        >
          <Icon name="upload" size={11} /> 导入预测
        </Button>
      </div>

      <PredictionImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId}
      />

      <Card>
        <div className={styles.cardHeader}>
          <strong className={styles.sectionTitle}>待预标批次（{batches.length}）</strong>
          {batches.length > 0 && (
            <label className={styles.inlineCheckbox}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选 active" />
              全选
            </label>
          )}
        </div>
        <div className={styles.cardBodyCompact}>
          {batchesQ.isLoading ? (
            <div className={styles.mutedText}>加载中…</div>
          ) : batches.length === 0 ? (
            <div className={styles.mutedText}>
              暂无 active 批次。在项目设置中创建批次后再回到这里跑预标。
            </div>
          ) : (
            <ul className={styles.batchList}>
              {batches.map((b) => (
                <li
                  key={b.id}
                  className={cx(styles.batchItem, selectedBatchIds.has(b.id) && styles.batchItemSelected)}
                  onClick={() => toggleBatch(b.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${b.name}`}
                    checked={selectedBatchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={styles.batchName}>
                    {b.name}{" "}
                    <span className={styles.subtleText}>({b.display_id})</span>
                  </span>
                  <span className={styles.taskCount}>
                    {b.total_tasks ?? "—"} 任务
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* v0.14.16 · 配置区常驻: 不再被 selectedBatchIds gate, 未选批次也可预先配置 / 存预设,
          仅"运行"按钮禁用 (见 canRun). */}
      <Card>
        <div className={styles.runPanel}>
          <strong className={styles.sectionTitle}>
            {selectedBatchIds.size > 0
              ? `对已选 ${selectedBatchIds.size} 批跑预标`
              : "批跑预标设置"}
          </strong>

            {/* v0.18.16 · 两列编排: 左 DAG 画布 (点选/增删/拖边改父), 右选中节点参数检查器。
                页面高度恒定 (右列永远一张卡), 结构所见即所得。 */}
            <div className={styles.editorTwoCol}>
              <div className={styles.editorCanvas}>
                <Suspense
                  fallback={<div className={styles.canvasFallback}>加载编排画布…</div>}
                >
                  <PipelineGraphCanvas
                    models={graphNodes}
                    selectedSid={selectedSid}
                    onSelect={setSelectedSid}
                    onAddChild={addStage}
                    onRemove={removeStage}
                    onReparent={onReparent}
                    canReparentConn={canReparentConn}
                  />
                </Suspense>
                {backends.length < 2 ? (
                  <span className={styles.stageEmptyHint}>
                    需在项目设置绑定第二个 ML backend，才能加下游分类/检测子阶段（下游须用不同于检测的后端）。
                  </span>
                ) : stagesGraph.length === 0 ? (
                  <span className={styles.stageEmptyHint}>
                    从源节点的 <Icon name="plus" size={10} /> 拖出（或点 +）加下游阶段：检出框后，下游对每个框跑分类补属性 / 检测子物体。
                  </span>
                ) : null}
              </div>

              {/* 检查器: 所有配置体常驻挂载, 非选中者 CSS 隐藏 (保住各自 usePreannotateConfig 状态)。 */}
              <div className={styles.editorInspector}>
                {/* 源参数 (检测): 选中源时显示。 */}
                <div hidden={selectedSid !== ROOT_SID}>
                  <strong className={styles.sectionTitle}>源阶段 · 检测参数</strong>
                  <PreannotateConfigForm
                    cfg={cfg}
                    backends={backends}
                    selectedBackendId={selectedBackendId}
                    onSelectBackend={setSelectedBackendId}
                    projectMlBackendId={project?.ml_backend_id}
                  />
                </div>
                {/* 各下游阶段卡: 全部挂载, 非选中 hidden。 */}
                {stagesGraph.map((e, i) => (
                  <StageCard
                    key={e.sid}
                    id={e.sid}
                    displayIndex={i + 2}
                    projectId={projectId}
                    backends={backends}
                    projectMlBackendId={project?.ml_backend_id}
                    sourceBackendId={selectedBackendId}
                    projectClasses={projectClasses}
                    parentClassOptions={sourceEffectiveClasses}
                    projectAttributeKeys={projectAttributeKeys}
                    conflictKeys={conflictInfo.perCard[e.sid]}
                    stat={stageStatByIndex.get(i + 1)}
                    runState={stageRunState(i + 1)}
                    hidden={selectedSid !== e.sid}
                    onChange={onStageChange}
                    onCaps={onStageCaps}
                    onRemove={removeStage}
                  />
                ))}
              </div>
            </div>

            {/* v0.18.5 · 键冲突配置期预警: 多个 attributes 阶段写同一最终键 → 红字提示 + 末位覆盖开关。 */}
            {hasKeyConflict && (
              <div className={styles.stageWarn}>
                <Icon name="warning" size={12} />
                <div className={styles.field}>
                  <span>
                    多个阶段写同一属性键：
                    {Array.from(conflictInfo.displayFinals).join("、")}。默认拦截，无法运行。
                  </span>
                  <label className={styles.inlineCheckbox}>
                    <input
                      type="checkbox"
                      checked={keyConflictLastWins}
                      onChange={(e) => setKeyConflictLastWins(e.target.checked)}
                    />
                    允许末位覆盖（last_wins）
                  </label>
                </div>
              </div>
            )}

            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                已预标任务
                {predictMode === "overwrite" && (
                  <span className={styles.fieldHint}> · 覆盖会删除已有 AI 标注</span>
                )}
              </span>
              <TabRow
                tabs={PREDICT_MODE_TABS}
                active={PREDICT_MODE_LABELS[predictMode]}
                onChange={(label) => {
                  const m = PREDICT_MODE_BY_LABEL[label];
                  if (m) setPredictMode(m);
                }}
              />
            </div>

            {selectedBatchIds.size > 1 && (
              <div role="radiogroup" aria-label="并发模式" className={styles.concurrencyGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "serial"}
                    onChange={() => setConcurrency("serial")}
                  />
                  串行（依次入队）
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "parallel"}
                    onChange={() => setConcurrency("parallel")}
                  />
                  并行（同时入队）
                </label>
                {summary?.ml_backend_max_concurrency != null && (
                  <span className={styles.mutedInline}>
                    （后端最多 {summary.ml_backend_max_concurrency} 并发）
                  </span>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button
                onClick={onRun}
                disabled={!canRun}
                title={
                  selectedBatchIds.size === 0
                    ? "请先选择至少一个批次"
                    : hasKeyConflict && !keyConflictLastWins
                      ? "存在属性键冲突，请勾选「允许末位覆盖」或调整各阶段写回键"
                      : undefined
                }
              >
                <Icon name="bot" size={12} />
                {running
                  ? cfg.isCurrentVariantWarm
                    ? "分发中..."
                    : "加载模型中…（首次约 5-15s）"
                  : selectedBatchIds.size === 0
                    ? "跑预标（先选批次）"
                    : `跑预标（${selectedBatchIds.size} 批）`}
              </Button>
              {/* v0.18.27 · 把当前配置存为「项目编排」(方案 A); v0.18.28 popover「运行当前题（按项目编排）」据此读取。 */}
              <Button
                variant="default"
                onClick={onSavePipeline}
                disabled={
                  !cfg.configReady ||
                  (stagesGraph.length > 0 && !allDownstreamReady) ||
                  updateProject.isPending
                }
                title="把当前配置（含多阶段编排）保存到项目，供工作台 popover 单图执行"
              >
                <Icon name="save" size={12} />
                保存为项目编排
              </Button>
              {savedStageCount > 0 && (
                <>
                  <Badge>已保存编排 · {savedStageCount} 阶段</Badge>
                  {/* claude[bot] P1 #5 · 引用的 backend 被删/停 → 工作台 popover「按编排跑」会禁用; 这里同时提示。 */}
                  {savedPipelineMissingBackendCount > 0 && (
                    <span
                      title="编排引用的 backend 不在本项目注册列表里 (被删或未注册); 工作台 popover「按编排跑」会被禁用, 请重新注册或修改编排"
                    >
                      <Badge variant="warning">
                        引用 {savedPipelineMissingBackendCount} 个后端不可用
                      </Badge>
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    onClick={onClearPipeline}
                    disabled={updateProject.isPending}
                    title="清除项目已保存的编排"
                  >
                    清除
                  </Button>
                </>
              )}
            </div>
          </div>
      </Card>

      <HistoryTable items={projectQueue} isLoading={queueQ.isLoading} />
    </div>
  );
}
