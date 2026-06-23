/**
 * v0.9.12 · BUG B-17 · 项目详情面板 (多选 batch + 串/并行预标 + 已就绪 HistoryTable).
 *
 * 进入条件: ProjectCardGrid 点击某项目卡片;此面板替代主视图渲染.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useMLBackends } from "@/hooks/useMLBackends";
import {
  useTriggerPreannotation,
  type PredictMode,
  type PipelineStagePayload,
} from "@/hooks/usePreannotation";
import type { PreannotateArgs } from "./usePreannotateConfig";
import { adminPreannotateApi } from "@/api/adminPreannotate";
import { HistoryTable } from "./HistoryTable";
import { VideoPreannotateGuide } from "./VideoPreannotateGuide";
import { PredictionImportWizard } from "@/components/predictions/PredictionImportWizard";
import { usePreannotateConfig } from "./usePreannotateConfig";
import { PreannotateConfigForm } from "./PreannotateConfigForm";
import { StageCard } from "./StageCard";
import styles from "./ProjectDetailPanel.module.css";

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
        box_threshold?: number | null;
        text_threshold?: number | null;
        // v0.14.13 · 项目级 variant 偏好 (按 backend_id 分桶), 详见 ProjectOut.default_variants.
        default_variants?: Record<string, Record<string, string>>;
      }
    | undefined;
  // v0.10.38 · 模态分流: summary 优先 (列表已带), 回落 project 查询.
  const dataType = summary?.data_type ?? project?.data_type ?? "image";

  const backendsQ = useMLBackends(projectId);
  const backends = (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>;
  // v0.10.38 · 多 backend 选择: 默认绑定值, 用户可在项目已注册 backend 间切换 (epic 阶段 2).
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);
  const firstBackendId = backends[0]?.id ?? null;
  useEffect(() => {
    // 项目切换 / 列表加载后, 默认选绑定 backend (否则第一个)
    setSelectedBackendId(project?.ml_backend_id ?? firstBackendId);
  }, [projectId, project?.ml_backend_id, firstBackendId]);
  const selectedBackend =
    backends.find((b) => b.id === selectedBackendId) ?? null;

  // 预标配置区共享状态 (任务类型 / 几何 task / 类别白名单 / variant / 参数 / prompt / 预设 /
  // 输出形态 / buildArgs); 详见 usePreannotateConfig. 工作台 AI 面板复用同一 hook + PreannotateConfigForm.
  const cfg = usePreannotateConfig({ projectId, backendId: selectedBackendId });

  // v0.18.2 · 多阶段预标注 (路径 B M2): 下游阶段卡列表 (并行兄弟, 单层扇出)。每张卡 (StageCard)
  // 自持一份 usePreannotateConfig + PreannotateConfigForm 实例 —— 共享 hook/组件本身不感知阶段
  // 编排 (红线)。卡片把派生 stage payload 上抛, 容器在运行时组装成 pipeline_stages。
  const [downstreamIds, setDownstreamIds] = useState<string[]>([]);
  const stagePayloadsRef = useRef<Record<string, PipelineStagePayload | null>>({});
  const [stageTick, setStageTick] = useState(0); // 卡片回报 payload → bump 触发 canRun 重算
  const onStageChange = useCallback(
    (sid: string, payload: PipelineStagePayload | null) => {
      stagePayloadsRef.current[sid] = payload;
      setStageTick((n) => n + 1);
    },
    [],
  );
  const seqRef = useRef(0);
  const addStage = () =>
    setDownstreamIds((ids) => [...ids, `stage-${(seqRef.current += 1)}`]);
  const removeStage = (sid: string) =>
    setDownstreamIds((ids) => ids.filter((x) => x !== sid));

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

  // 项目切换时重置批次选择 + 下游阶段卡 (prompt / outputMode 的重置在 usePreannotateConfig 内).
  useEffect(() => {
    setSelectedBatchIds(new Set());
    setDownstreamIds([]);
    stagePayloadsRef.current = {};
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

  // 下游卡的派生 payload (stageTick 变化时重算); 全部就绪才允许跑。
  const downstreamPayloads = useMemo(
    () => downstreamIds.map((sid) => stagePayloadsRef.current[sid] ?? null),
    // stagePayloadsRef 是 ref, 卡片回报后靠 stageTick 触发重算 (eslint 看不到这层)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [downstreamIds, stageTick],
  );
  const allDownstreamReady = downstreamPayloads.every((p) => p != null);

  // 配置层就绪 (源 cfg.configReady) && 下游卡 (若有) 全就绪 && 选了批次 && 不在跑。
  const canRun =
    cfg.configReady &&
    (downstreamIds.length === 0 || allDownstreamReady) &&
    selectedBatchIds.size > 0 &&
    !running;

  const onRun = async () => {
    const baseArgs = cfg.buildArgs(predictMode);
    if (!baseArgs || selectedBatchIds.size === 0) return;
    // v0.18.2 · 有下游阶段卡且全就绪 → 组装 pipeline_stages (源 + N 个并行兄弟 classify)。
    // 源阶段 ml_backend_id 须等于顶层 (baseArgs.ml_backend_id), 后端据此复用既有 backend 校验。
    let pipelineStages: PipelineStagePayload[] | undefined;
    if (downstreamIds.length > 0) {
      if (!allDownstreamReady) return;
      pipelineStages = [
        argsToStage(baseArgs, 0),
        ...downstreamPayloads.map((p, i) => ({
          ...(p as PipelineStagePayload),
          stage: i + 1,
          parent_stage: 0,
        })),
      ];
    }
    const ids = Array.from(selectedBatchIds);
    setRunning(true);
    try {
      let okCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      const fireOne = async (bid: string) => {
        try {
          await trigger.mutateAsync({
            ...baseArgs,
            batch_id: bid,
            ...(pipelineStages ? { pipeline_stages: pipelineStages } : {}),
          });
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
      if (failCount > 0 && errors.length > 0) {
        console.warn("[ai-pre] 多批次预标部分失败:", errors);
      }
      if (okCount > 0) {
        setSelectedBatchIds(new Set());
        // v0.14.13 · 至少一批成功 → 记 variant 已热 (异步 trigger 拿不到 cache_hit, 走兜底).
        cfg.markHot();
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

            {/* 共享配置区 (任务类型 / 模型任务 / 类别白名单 / prompt / backend 多选 /
                params+variant / 预设 / 输出形态); 工作台 AI 面板复用同一组件. */}
            <PreannotateConfigForm
              cfg={cfg}
              backends={backends}
              selectedBackendId={selectedBackendId}
              onSelectBackend={setSelectedBackendId}
              projectMlBackendId={project?.ml_backend_id}
            />

            {/* v0.18.2 · 多阶段预标注 (路径 B M2): 下游阶段卡 (并行兄弟, 单层扇出)。
                每张卡对源阶段检测框按类别裁 ROI 喂下游分类, 结果合并进框属性; 多卡 = 同类/不同类
                各喂不同分类器 (声明式类别路由)。 */}
            {downstreamIds.map((sid, i) => (
              <StageCard
                key={sid}
                id={sid}
                displayIndex={i + 2}
                projectId={projectId}
                backends={backends}
                projectMlBackendId={project?.ml_backend_id}
                sourceBackendId={selectedBackendId}
                onChange={onStageChange}
                onRemove={removeStage}
              />
            ))}

            <div className={styles.field}>
              <Button size="sm" variant="ghost" onClick={addStage}>
                <Icon name="plus" size={11} />
                {downstreamIds.length === 0
                  ? "加第二阶段（对每个检测框跑分类 → 写回属性）"
                  : "并行加同级阶段（同源、各写不同属性）"}
              </Button>
            </div>

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
            </div>
          </div>
      </Card>

      <HistoryTable items={projectQueue} isLoading={queueQ.isLoading} />
    </div>
  );
}
