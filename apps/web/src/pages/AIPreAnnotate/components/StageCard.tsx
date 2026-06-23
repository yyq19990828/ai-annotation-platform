/**
 * v0.18.2 · 多阶段预标注「下游阶段卡」(路径 B M2).
 *
 * 每张卡自持一份 usePreannotateConfig + PreannotateConfigForm 实例 (复用共享组件, 不改其本身,
 * 红线), 再补 M2 的阶段级字段: 父框类别过滤 (parent_class_filter) / ROI 扩展 (roi.pad) /
 * 写回属性键 (write.keys)。卡片把派生出的 stage payload 通过 onChange 上抛给容器, 由容器在运行时
 * 组装成 pipeline_stages 的并行兄弟。多张卡共享同一源阶段 = 单层并行扇出。
 *
 * v0.18.5 · 配置硬化: parent_class_filter / write.keys 由自由文本框升级为选择器 (类别取项目类别,
 * 属性键取下游 backend 自报 output_attribute_schema, 回落项目 attribute_schema), 消灭拼写误配;
 * 下游 backend 不产属性时给 ⚠ 警示; 键冲突 chip 由容器传 conflictKeys 标红。
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { usePreannotateConfig, type PreannotateArgs } from "./usePreannotateConfig";
import { PreannotateConfigForm } from "./PreannotateConfigForm";
import type {
  PipelineStagePayload,
  PipelineStageStat,
} from "@/hooks/usePreannotation";
import styles from "./ProjectDetailPanel.module.css";

// v0.18.8 · 运行态 → Badge 原语 (语义色 + 暗色配对走设计系统, 不裸色)。
const RUN_STATE_BADGE: Record<
  string,
  { variant: "outline" | "ai" | "success" | "danger"; label: string; dot?: boolean }
> = {
  pending: { variant: "outline", label: "待运行" },
  running: { variant: "ai", label: "运行中", dot: true },
  done: { variant: "success", label: "已完成" },
  failed: { variant: "danger", label: "失败" },
};

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

/** 通用 chip 多选 (类别 / 属性键共用)。选中集合即语义值, 空集=全部。conflictKeys 命中的 chip 标红。 */
function ChipMultiSelect({
  options,
  selected,
  onChange,
  conflictKeys,
  emptyHint,
}: {
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  conflictKeys?: Set<string>;
  emptyHint?: string;
}) {
  if (options.length === 0) {
    return <span className={styles.mutedText}>{emptyHint ?? "无可选项"}</span>;
  }
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };
  return (
    <div className={styles.aliasList}>
      {options.map((o) => {
        const active = selected.has(o.value);
        const conflict = active && conflictKeys?.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cx(
              styles.aliasChip,
              active && styles.aliasChipActive,
              conflict && styles.aliasChipConflict,
            )}
            title={conflict ? `属性键 ${o.value} 与其它并行阶段冲突` : o.label}
          >
            <span>
              {active ? "✓ " : ""}
              {o.label}
            </span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className={styles.refillButton}
          title="清空选择"
        >
          清空
        </button>
      )}
    </div>
  );
}

interface Props {
  id: string;
  /** 1-based 展示序号 (源阶段是 1, 第一张下游卡是 2…)。 */
  displayIndex: number;
  projectId: string;
  backends: Array<{ id: string; name: string }>;
  projectMlBackendId?: string | null;
  /** 源阶段 backend, 用于默认选一个不同的下游 backend。 */
  sourceBackendId: string | null;
  /** v0.18.5 · 项目类别 (类名)，父框类别过滤多选的选项。 */
  projectClasses: string[];
  /** v0.18.5 · 项目 attribute_schema 字段键，写回属性键多选的回落选项 (backend 未自报 schema 时)。 */
  projectAttributeKeys: string[];
  /** v0.18.5 · 本卡 write.keys 中与其它并行阶段冲突的键 (容器算好下发), 命中 chip 标红。 */
  conflictKeys?: Set<string>;
  /** v0.18.6 · 本阶段运行态统计 (容器从实时/终态下发); 无=未跑。 */
  stat?: PipelineStageStat;
  /** v0.18.6 · 本阶段运行态 (徽标用): pending/running/done。 */
  runState?: "pending" | "running" | "done";
  /** 派生出的 stage payload (未就绪=null) 上抛给容器; 容器据此组装 pipeline_stages。 */
  onChange: (id: string, payload: PipelineStagePayload | null) => void;
  onRemove: (id: string) => void;
}

export function StageCard({
  id,
  displayIndex,
  projectId,
  backends,
  projectMlBackendId,
  sourceBackendId,
  projectClasses,
  projectAttributeKeys,
  conflictKeys,
  stat,
  runState = "pending",
  onChange,
  onRemove,
}: Props) {
  const [backendId, setBackendId] = useState<string | null>(() => {
    const other = backends.find((b) => b.id !== sourceBackendId);
    return other?.id ?? null;
  });
  const cfg = usePreannotateConfig({ projectId, backendId });

  const [classFilter, setClassFilter] = useState<Set<string>>(new Set());
  const [pad, setPad] = useState(0.05);
  const [writeKeys, setWriteKeys] = useState<Set<string>>(new Set());

  // v0.18.5 · 写回属性键选项: 优先下游 backend 自报 output_attribute_schema 的 key (最准),
  // 回落项目 attribute_schema 字段 key。
  const backendAttrOptions = useMemo(() => {
    const models = cfg.capabilitiesQ.data?.models ?? [];
    const seen = new Map<string, string>();
    for (const m of models) {
      for (const a of m.output_attribute_schema ?? []) {
        if (a?.key && !seen.has(a.key)) seen.set(a.key, a.label || a.key);
      }
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [cfg.capabilitiesQ.data]);

  const attrKeyOptions =
    backendAttrOptions.length > 0
      ? backendAttrOptions
      : projectAttributeKeys.map((k) => ({ value: k, label: k }));

  // 下游 backend 是否会产属性 (自报 schema / types 任一非空)。capabilities 就绪后才判定。
  const capabilitiesReady =
    !cfg.capabilitiesQ.isLoading && cfg.capabilitiesQ.data != null;
  const producesAttributes = useMemo(() => {
    const models = cfg.capabilitiesQ.data?.models ?? [];
    return models.some(
      (m) =>
        (m.output_attribute_schema?.length ?? 0) > 0 ||
        (m.output_attribute_types?.length ?? 0) > 0,
    );
  }, [cfg.capabilitiesQ.data]);
  const showNoAttrWarning =
    backendId != null && capabilitiesReady && !producesAttributes;

  const stageArgs: PreannotateArgs | null = cfg.configReady
    ? cfg.buildArgs("skip_predicted")
    : null;

  // 派生 stage payload (不含 stage 序号 / parent_stage, 由容器补)。
  const payload = useMemo<Omit<PipelineStagePayload, "stage" | "parent_stage"> | null>(() => {
    if (!stageArgs) return null;
    const classArr = Array.from(classFilter);
    const keyArr = Array.from(writeKeys);
    return {
      ml_backend_id: stageArgs.ml_backend_id,
      model_id: stageArgs.model_id,
      task_type: stageArgs.task_type,
      model_variants: stageArgs.model_variants,
      params: stageArgs.params,
      class_filter: stageArgs.class_filter,
      parent_class_filter: classArr.length > 0 ? classArr : undefined,
      roi: { mode: "crop", pad },
      write: {
        target: "attributes",
        ...(keyArr.length > 0 ? { keys: keyArr } : {}),
      },
    };
    // stageArgs 是每次渲染新对象, 用 JSON 串作稳定依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stageArgs), classFilter, pad, writeKeys]);

  // 用 ref 固定 onChange, 避免容器每次渲染触发本 effect。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(id, payload as PipelineStagePayload | null);
  }, [id, payload]);
  // 卸载时清掉本卡的贡献。
  useEffect(() => {
    return () => onChangeRef.current(id, null);
  }, [id]);

  const badge = RUN_STATE_BADGE[runState] ?? RUN_STATE_BADGE.pending;
  const targeted = stat?.targeted ?? 0;
  const okPct = targeted > 0 ? ((stat?.ok ?? 0) / targeted) * 100 : 0;

  return (
    <Card className={styles.stageCard}>
      <div className={styles.stageCardHeader}>
        <span className={styles.stageRole}>
          <Icon name="brain" size={13} />
          <Badge variant="accent">分类</Badge>
          <strong className={styles.sectionTitle}>阶段 {displayIndex}</strong>
        </span>
        <span className={styles.stageHeaderRight}>
          <Badge variant={badge.variant} dot={badge.dot}>
            {badge.label}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => onRemove(id)} title="移除该阶段">
            <Icon name="trash" size={11} />
          </Button>
        </span>
      </div>

      {/* v0.18.8 · 运行态: 进度条 (成功/目标) + 计数块 (StatCard 风格), 替换纯文本行。 */}
      {stat && (
        <div className={styles.stageRun}>
          <ProgressBar value={okPct} />
          <div className={styles.stageCounts}>
            <span className={styles.stageCount}>
              <span className={styles.stageCountLabel}>目标</span>
              <span className={styles.stageCountValue}>{targeted}</span>
            </span>
            <span className={styles.stageCount}>
              <span className={styles.stageCountLabel}>成功</span>
              <span className="text-status-positive">{stat.ok ?? 0}</span>
            </span>
            {(stat.failed ?? 0) > 0 && (
              <span className={styles.stageCount}>
                <span className={styles.stageCountLabel}>失败</span>
                <span className="text-status-caution">{stat.failed}</span>
              </span>
            )}
            {(stat.skipped_geometry ?? 0) > 0 && (
              <span className={cx(styles.stageCount, styles.mutedText)}>
                <span className={styles.stageCountLabel}>几何跳过</span>
                <span>{stat.skipped_geometry}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <PreannotateConfigForm
        cfg={cfg}
        backends={backends}
        selectedBackendId={backendId}
        onSelectBackend={setBackendId}
        projectMlBackendId={projectMlBackendId}
      />

      {showNoAttrWarning && (
        <div className={styles.stageWarn}>
          <Icon name="warning" size={12} />
          <span>
            该后端未自报输出属性，作下游分类只会重新检测、属性恒空。请改选会产属性的后端。
          </span>
        </div>
      )}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          父框类别（留空=对全部父框跑；按检测框类名匹配）
        </span>
        <ChipMultiSelect
          options={projectClasses.map((c) => ({ value: c, label: c }))}
          selected={classFilter}
          onChange={setClassFilter}
          emptyHint="项目暂无类别配置，留空=对全部父框跑"
        />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>ROI 扩展 pad（0–0.5）</span>
        <input
          className={styles.textInput}
          type="number"
          min={0}
          max={0.5}
          step={0.01}
          value={pad}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) setPad(Math.min(0.5, Math.max(0, v)));
          }}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          写回属性键（留空=接收下游返回的全部键）
          {backendAttrOptions.length === 0 && attrKeyOptions.length > 0 && (
            <span className={styles.fieldHint}> · 选项来自项目属性 schema</span>
          )}
        </span>
        <ChipMultiSelect
          options={attrKeyOptions}
          selected={writeKeys}
          onChange={setWriteKeys}
          conflictKeys={conflictKeys}
          emptyHint="下游 backend 未自报属性 schema，且项目无属性字段；留空=接收全部键"
        />
      </div>
    </Card>
  );
}
