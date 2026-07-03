/**
 * v0.21.0 · 全局编排库 UI (WS2 落地 + 收尾优化).
 *
 * 从全局 backend/model 池搭一条**多层 DAG** 编排, 存为公共/组织命名编排, 后续在项目预标入口
 * "套用为项目默认". 与 ProjectDetailPanel 共用 usePipelineComposer 状态机 (v0.21.0 refactor):
 * 加子/改父/键冲突判据全在 hook 里, 两页保持结构一致.
 *
 * Inspector 走精简版 GlobalStageInspector — 三格候选与项目侧同源: 源类别取 model.classes,
 * 父框类别取上游 model.classes.name, 写回属性键取 model.output_attribute_schema; 缺的是
 * 项目类别 / 项目 attribute schema 那条"最后回落"(全局侧本就无项目上下文, 也不该有). variant /
 * params 留白, 项目套用后由项目侧 StageCard 拉 backend setup schema 后补齐.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { useCapabilityInstances } from "@/api/mlCapabilities";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useCreateProjectPipeline,
  useDeleteProjectPipeline,
  useProjectPipelines,
} from "@/hooks/useProjectPipelines";
import type { ProjectPipeline, ProjectPipelineScope } from "@/api/projectPipelines";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";
import { usePipelineComposer } from "./hooks/usePipelineComposer";
import { GlobalStageInspector, type GlobalModelOption } from "./components/GlobalStageInspector";
import {
  ROOT_SID,
  classFilterText,
  deriveSourceShape,
  detailOf,
  producesGeometry,
  roleOf,
  stageWarning,
  variantText,
  roiText,
  type GraphNodeModel,
  type StageEntry,
} from "./utils/pipelineGraph";

const SCOPE_LABELS: Record<ProjectPipelineScope, string> = {
  private: "私有",
  organization: "组织",
  public: "公共",
};
import styles from "./GlobalPipelineLibraryPage.module.css";

const PipelineGraphCanvas = lazy(() => import("./components/PipelineGraphCanvas"));

export default function GlobalPipelineLibraryPage() {
  const pushToast = useToastStore((s) => s.push);
  const createProjectPipeline = useCreateProjectPipeline();
  const capabilityInstancesQ = useCapabilityInstances();
  const [pipelineName, setPipelineName] = useState("");
  const [pipelineScope, setPipelineScope] = useState<Extract<ProjectPipelineScope, "public" | "organization">>("public");

  // 全局池: 所有 backend × 所有 model 展平 (backend state=error 保留展示但禁用).
  const globalModelOptions = useMemo<GlobalModelOption[]>(() => {
    const out: GlobalModelOption[] = [];
    for (const inst of capabilityInstancesQ.data?.instances ?? []) {
      for (const model of inst.models ?? []) {
        out.push({
          key: `${inst.backend_id}::${model.id}`,
          backendId: inst.backend_id,
          backendName: inst.name,
          model,
          disabled: inst.state === "error",
        });
      }
    }
    return out;
  }, [capabilityInstancesQ.data]);

  // 下游可用 backend 数 = 全局池 unique backends (源恒可选, 下游须用不同于源 backend).
  // 复用 usePipelineComposer 的 canAddChildAt 判据 — <2 时源节点上 + 号被禁.
  const uniqueBackendCount = useMemo(() => {
    const set = new Set<string>();
    for (const o of globalModelOptions) if (!o.disabled) set.add(o.backendId);
    return set.size;
  }, [globalModelOptions]);

  const {
    stagesGraph,
    setStagesGraph,
    selectedSid,
    setSelectedSid,
    onStageChange,
    onStageCaps,
    downstreamPayloads,
    allDownstreamReady,
    addStage,
    removeStage,
    onReparent,
    canReparentConn,
    canAddChildAt,
    conflictInfo,
    hasKeyConflict,
    stageCapsRef,
    reset: resetComposer,
  } = usePipelineComposer({
    availableBackendCount: uniqueBackendCount,
    onWarn: (msg, sub) => pushToast({ msg, sub, kind: "warning" }),
    onCascadeDelete: (n) =>
      pushToast({ msg: "已删除阶段", sub: `连带移除 ${n} 个子阶段` }),
  });

  // 源阶段 payload (Inspector 独立管).
  const [sourcePayload, setSourcePayload] = useState<PipelineStagePayload | null>(null);
  // 加载编辑用: 初次 mount 时 Inspector 会读 value 反向初始化; 用户改字段后 downstreamPayloads 覆盖.
  const [loadedSourceSeed, setLoadedSourceSeed] = useState<PipelineStagePayload | null>(null);
  const [loadedDownstreamSeedBySid, setLoadedDownstreamSeedBySid] = useState<
    Record<string, PipelineStagePayload>
  >({});
  const onSourceChange = useCallback((payload: PipelineStagePayload | null) => {
    setSourcePayload(payload);
  }, []);
  // 源阶段 caps 走 stageCapsRef.current[ROOT_SID] 一样的模式; 借 composer 的 onStageCaps.
  const onSourceCaps = useCallback(
    (caps: Parameters<typeof onStageCaps>[1]) => onStageCaps(ROOT_SID, caps),
    [onStageCaps],
  );

  const nameOfBackend = useCallback(
    (id?: string | null) => globalModelOptions.find((o) => o.backendId === id)?.backendName,
    [globalModelOptions],
  );

  // v0.21.0 再修正 · 下游"父框类别"候选取上游 model.classes.name (与项目侧 parentClassOptions 同源).
  //   父 sid → 查父 payload → (backendId, modelId) → 全局池 model.classes → name[]. 无候选=空数组,
  //   Inspector 里 ChipMultiSelect 走自由文本兜底.
  const classesForSid = useCallback(
    (sid: string): string[] => {
      const payload =
        sid === ROOT_SID
          ? sourcePayload
          : downstreamPayloads[stagesGraph.findIndex((s) => s.sid === sid)] ?? null;
      if (!payload?.ml_backend_id || !payload?.model_id) return [];
      const opt = globalModelOptions.find(
        (o) => o.key === `${payload.ml_backend_id}::${payload.model_id}`,
      );
      return (opt?.model.classes ?? []).map((c) => c.name);
    },
    [sourcePayload, downstreamPayloads, stagesGraph, globalModelOptions],
  );

  // 汇总所有 warning (源 + 下游), 顶部条展示.
  const allWarnings = useMemo(() => {
    const out: string[] = [];
    const srcWarn = stageWarning(sourcePayload, stageCapsRef.current[ROOT_SID]);
    if (srcWarn) out.push(`源: ${srcWarn}`);
    stagesGraph.forEach((e, i) => {
      const w = stageWarning(downstreamPayloads[i], stageCapsRef.current[e.sid]);
      if (w) out.push(`阶段 ${i + 2}: ${w}`);
    });
    return out;
  }, [sourcePayload, stagesGraph, downstreamPayloads, stageCapsRef]);

  // graphNodes: 组装源 + 下游节点给画布. 与项目侧结构等价, 缺"运行态" (全局侧不跑).
  const graphNodes = useMemo<GraphNodeModel[]>(() => {
    const srcOption = sourcePayload
      ? globalModelOptions.find((o) => o.key === `${sourcePayload.ml_backend_id}::${sourcePayload.model_id}`)
      : null;
    // v0.21.1 WS0 · 源形态由 model.task + 词表派生, 不 hardcode「检测」。
    const srcShape = deriveSourceShape(srcOption?.model);
    const source: GraphNodeModel = {
      sid: ROOT_SID,
      parentSid: null,
      kind: "source",
      role: srcShape.role,
      detail: srcOption?.model.display_name ?? "请配置源阶段模型",
      runState: "pending",
      producesGeometry: true,
      canAddChild: canAddChildAt(ROOT_SID),
      conflict: false,
      ready: !!sourcePayload,
      backendName: srcOption?.backendName,
      modelId: srcOption?.model.id,
      taskType: srcOption?.model.task,
      sourceTypeLabel: srcShape.sourceTypeLabel,
      sourceCountLabel: srcShape.countLabel,
      warning: stageWarning(sourcePayload, stageCapsRef.current[ROOT_SID]),
    };
    const stages = stagesGraph.map<GraphNodeModel>((e, i) => {
      const p = downstreamPayloads[i];
      return {
        sid: e.sid,
        parentSid: e.parentSid,
        kind: "stage",
        role: roleOf(p),
        detail: detailOf(p),
        runState: "pending",
        producesGeometry: producesGeometry(p),
        canAddChild: canAddChildAt(e.sid),
        conflict: (conflictInfo.perCard[e.sid]?.size ?? 0) > 0,
        ready: p != null,
        backendName: nameOfBackend(p?.ml_backend_id),
        warning: stageWarning(p, stageCapsRef.current[e.sid]),
        classFilter: classFilterText(p),
        modelId: p?.model_id,
        taskType: p?.task_type,
        roiInfo: roiText(p),
        variantInfo: variantText(p),
      };
    });
    return [source, ...stages];
    // stageCapsRef.current 是 ref, 靠 composer 内部 tick 通过 downstreamPayloads 回传时触发重算.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourcePayload,
    stagesGraph,
    downstreamPayloads,
    canAddChildAt,
    conflictInfo,
    nameOfBackend,
    globalModelOptions,
  ]);

  // sid → 下游卡序号 (源固定 0, 下游按 stagesGraph 顺序 1..N; 父总在前故父序号 < 子序号).
  const stageNumberBySid = useMemo(() => {
    const m: Record<string, number> = { [ROOT_SID]: 0 };
    stagesGraph.forEach((e, i) => {
      m[e.sid] = i + 1;
    });
    return m;
  }, [stagesGraph]);

  // 保存: 组装 pipeline_stages (源 + N 下游, 按 sid 序号) → POST /project-pipelines (scope=public).
  const savePipeline = async () => {
    const name = pipelineName.trim();
    if (!name) {
      pushToast({ msg: "请输入编排名称", kind: "warning" });
      return;
    }
    if (!sourcePayload) {
      pushToast({ msg: "请配置源阶段模型", kind: "warning" });
      return;
    }
    if (stagesGraph.length > 0 && !allDownstreamReady) {
      pushToast({ msg: "下游阶段未就绪", sub: "请配齐各阶段参数", kind: "warning" });
      return;
    }
    if (hasKeyConflict) {
      pushToast({
        msg: "存在属性键冲突",
        sub: `冲突键: ${Array.from(conflictInfo.displayFinals).join("、")}`,
        kind: "warning",
      });
      return;
    }

    const stages: PipelineStagePayload[] = [{ ...sourcePayload, stage: 0 }];
    stagesGraph.forEach((e, i) => {
      const p = downstreamPayloads[i];
      if (!p) return;
      stages.push({
        ...p,
        stage: i + 1,
        parent_stage: stageNumberBySid[e.parentSid],
      });
    });

    try {
      await createProjectPipeline.mutateAsync({
        name,
        scope: pipelineScope,
        project_id: null,
        organization_id: null,
        stages,
        is_default: false,
      });
      pushToast({
        msg: pipelineScope === "public" ? "已保存为公共编排" : "已保存为组织编排",
        sub: `${stages.length} 阶段 · 可在项目预标入口套用`,
        kind: "success",
      });
    } catch (e) {
      pushToast({
        msg: "保存编排失败",
        sub: (e as Error).message,
        kind: "warning",
      });
    }
  };

  // 若 stagesGraph 变空 → 选中回落 root (由 composer removeStage 内部已处理; effect 兜底).
  useEffect(() => {
    if (selectedSid !== ROOT_SID && !stagesGraph.some((e) => e.sid === selectedSid)) {
      setSelectedSid(ROOT_SID);
    }
  }, [selectedSid, stagesGraph, setSelectedSid]);

  // ── 命名编排库: 列出 public / organization; 加载编辑; 删除 ─────────────────
  const projectPipelinesQ = useProjectPipelines(undefined);
  const deleteProjectPipeline = useDeleteProjectPipeline();
  const libraryPipelines = useMemo(
    () =>
      (projectPipelinesQ.data ?? []).filter(
        (p) => p.scope === "public" || p.scope === "organization",
      ),
    [projectPipelinesQ.data],
  );

  const loadFromPipeline = useCallback(
    (p: ProjectPipeline) => {
      resetComposer();
      setPipelineName(p.name);
      if (p.scope === "public" || p.scope === "organization") {
        setPipelineScope(p.scope);
      }
      const stages = p.stages ?? [];
      if (stages.length === 0) return;
      // 源阶段 (stage=0): 落 loadedSourceSeed 与 sourcePayload 双写, 避免 Inspector 未及回填时保存空.
      setLoadedSourceSeed(stages[0]);
      setSourcePayload(stages[0]);
      // 下游: parent_stage=0 → ROOT_SID; 否则 loaded-<parent_stage>.
      const newGraph: StageEntry[] = [];
      const seed: Record<string, PipelineStagePayload> = {};
      for (let i = 1; i < stages.length; i++) {
        const s = stages[i];
        const sid = `loaded-${s.stage}`;
        const parentSid =
          s.parent_stage == null || s.parent_stage === 0
            ? ROOT_SID
            : `loaded-${s.parent_stage}`;
        newGraph.push({ sid, parentSid });
        seed[sid] = s;
      }
      setStagesGraph(newGraph);
      setLoadedDownstreamSeedBySid(seed);
      setSelectedSid(ROOT_SID);
      pushToast({
        msg: "已加载到画布",
        sub: `${p.name} · ${stages.length} 阶段`,
        kind: "success",
      });
    },
    [resetComposer, setStagesGraph, setSelectedSid, pushToast],
  );

  const onDeletePipeline = (id: string, name: string) => {
    deleteProjectPipeline.mutate(id, {
      onSuccess: () =>
        pushToast({ msg: "已删除命名编排", sub: name, kind: "success" }),
      onError: (e) =>
        pushToast({
          msg: "删除命名编排失败",
          sub: (e as Error).message,
          kind: "warning",
        }),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageIntro}>
        <div>
          <h1 className={styles.pageTitle}>编排库</h1>
          <div className={styles.pageSubtitle}>
            从全局 backend/model 池创建可复用编排；项目页只负责套用到当前项目。
          </div>
        </div>
      </div>

      <Card>
        <div className={styles.toolbar}>
          <div className={styles.toolbarGroup}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>保存名称</span>
              <input
                className={styles.textInput}
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="例如 detect → 车辆属性"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>可见范围</span>
              <select
                className={styles.selectInput}
                value={pipelineScope}
                onChange={(e) =>
                  setPipelineScope(
                    e.target.value as Extract<ProjectPipelineScope, "public" | "organization">,
                  )
                }
                aria-label="全局编排可见范围"
              >
                <option value="public">公共</option>
                <option value="organization">组织</option>
              </select>
              {pipelineScope === "organization" && (
                <span className={styles.hint}>
                  组织编排需在创建后通过 PATCH 指定 organization_id（首版未提供 UI 字段）
                </span>
              )}
            </label>
          </div>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="primary"
              onClick={savePipeline}
              disabled={!sourcePayload || createProjectPipeline.isPending}
              title="把画布上的 DAG 保存为公共命名编排"
            >
              <Icon name="save" size={12} />
              保存公共编排
            </Button>
          </div>
        </div>

        {allWarnings.length > 0 && (
          <div className={styles.warnBar}>
            <Icon name="warning" size={12} />
            <div>
              <strong>{allWarnings.length} 个警示</strong>
              <ul className={styles.warnList}>
                {allWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {hasKeyConflict && (
          <div className={styles.warnBar}>
            <Icon name="warning" size={12} />
            <span>
              多个阶段写同一属性键：
              {Array.from(conflictInfo.displayFinals).join("、")}。保存会被拒绝，请调整
              各阶段 label / write.keys。
            </span>
          </div>
        )}

        <div className={styles.editorTwoCol}>
          <div className={styles.editorCanvas}>
            <Suspense fallback={<div className={styles.canvasFallback}>加载编排画布…</div>}>
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
            {uniqueBackendCount < 2 ? (
              <span className={styles.stageEmptyHint}>
                全局池至少需要 2 个不同 backend 才能加下游阶段（下游须用不同于源的 backend）。
              </span>
            ) : stagesGraph.length === 0 ? (
              <span className={styles.stageEmptyHint}>
                从源节点的 <Icon name="plus" size={10} /> 拖出（或点 +）加下游阶段：源出框后，
                下游对每个框跑分类/检测子物体。
              </span>
            ) : null}
          </div>

          <div className={styles.editorInspector}>
            <GlobalStageInspector
              kind="source"
              stageIndex={0}
              pool={globalModelOptions}
              value={sourcePayload ?? loadedSourceSeed}
              onChange={onSourceChange}
              onCaps={onSourceCaps}
              hidden={selectedSid !== ROOT_SID}
              displayIndex={1}
            />
            {stagesGraph.map((e, i) => (
              <GlobalStageInspector
                key={e.sid}
                kind="stage"
                stageIndex={i + 1}
                parentStageIndex={stageNumberBySid[e.parentSid]}
                pool={globalModelOptions}
                parentClasses={classesForSid(e.parentSid)}
                value={downstreamPayloads[i] ?? loadedDownstreamSeedBySid[e.sid] ?? null}
                onChange={(payload) => onStageChange(e.sid, payload)}
                onCaps={(caps) => onStageCaps(e.sid, caps)}
                onRemove={() => removeStage(e.sid)}
                warning={stageWarning(downstreamPayloads[i], stageCapsRef.current[e.sid])}
                conflictKeys={conflictInfo.perCard[e.sid]}
                hidden={selectedSid !== e.sid}
                displayIndex={i + 2}
              />
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.libraryHeader}>
          <strong className={styles.sectionTitle}>命名编排库（公共 / 组织）</strong>
          <span className={styles.hint}>
            列出所有 public / organization 编排; 可加载回画布编辑, 或删除.
          </span>
        </div>
        {projectPipelinesQ.isLoading ? (
          <div className={styles.stageEmptyHint}>加载中…</div>
        ) : libraryPipelines.length === 0 ? (
          <div className={styles.stageEmptyHint}>暂无命名编排。保存一条上方画布后会出现在这里。</div>
        ) : (
          <ul className={styles.libraryList}>
            {libraryPipelines.map((p) => (
              <li key={p.id} className={styles.libraryRow}>
                <div className={styles.libraryRowMain}>
                  <strong>{p.name}</strong>
                  <span className={styles.libraryMeta}>
                    {SCOPE_LABELS[p.scope]} · {p.stages.length} 阶段 · 已套用 {p.usage_count ?? 0} 次
                  </span>
                </div>
                <div className={styles.libraryRowActions}>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => loadFromPipeline(p)}
                    title="把这条编排回填到上方画布, 可继续编辑保存为新条"
                  >
                    <Icon name="download" size={12} />
                    加载编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeletePipeline(p.id, p.name)}
                    disabled={deleteProjectPipeline.isPending}
                    title="删除该命名编排 (仅所有者/超管可删)"
                  >
                    <Icon name="trash" size={12} />
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
