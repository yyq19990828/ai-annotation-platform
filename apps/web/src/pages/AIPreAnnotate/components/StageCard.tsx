/**
 * v0.18.2 · 多阶段预标注「下游阶段卡」(路径 B M2).
 *
 * 每张卡自持一份 usePreannotateConfig + PreannotateConfigForm 实例 (复用共享组件, 不改其本身,
 * 红线), 再补 M2 的阶段级字段: 父框类别过滤 (parent_class_filter) / ROI 扩展 (roi.pad) /
 * 写回属性键 (write.keys)。卡片把派生出的 stage payload 通过 onChange 上抛给容器, 由容器在运行时
 * 组装成 pipeline_stages 的并行兄弟。多张卡共享同一源阶段 = 单层并行扇出。
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { usePreannotateConfig, type PreannotateArgs } from "./usePreannotateConfig";
import { PreannotateConfigForm } from "./PreannotateConfigForm";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";
import styles from "./ProjectDetailPanel.module.css";

function parseCsv(s: string): string[] | undefined {
  const arr = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : undefined;
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
  onChange,
  onRemove,
}: Props) {
  const [backendId, setBackendId] = useState<string | null>(() => {
    const other = backends.find((b) => b.id !== sourceBackendId);
    return other?.id ?? null;
  });
  const cfg = usePreannotateConfig({ projectId, backendId });

  const [classFilter, setClassFilter] = useState("");
  const [pad, setPad] = useState(0.05);
  const [writeKeys, setWriteKeys] = useState("");

  const stageArgs: PreannotateArgs | null = cfg.configReady
    ? cfg.buildArgs("skip_predicted")
    : null;

  // 派生 stage payload (不含 stage 序号 / parent_stage, 由容器补)。
  const payload = useMemo<Omit<PipelineStagePayload, "stage" | "parent_stage"> | null>(() => {
    if (!stageArgs) return null;
    return {
      ml_backend_id: stageArgs.ml_backend_id,
      model_id: stageArgs.model_id,
      task_type: stageArgs.task_type,
      model_variants: stageArgs.model_variants,
      params: stageArgs.params,
      class_filter: stageArgs.class_filter,
      parent_class_filter: parseCsv(classFilter),
      roi: { mode: "crop", pad },
      write: (() => {
        const keys = parseCsv(writeKeys);
        return { target: "attributes", ...(keys ? { keys } : {}) };
      })(),
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

  return (
    <div className={styles.stageTwoBlock}>
      <div className={styles.cardHeader}>
        <strong className={styles.sectionTitle}>
          阶段 {displayIndex} · 分类（对父框 ROI）
        </strong>
        <Button size="sm" variant="ghost" onClick={() => onRemove(id)} title="移除该阶段">
          <Icon name="trash" size={11} /> 移除
        </Button>
      </div>

      <PreannotateConfigForm
        cfg={cfg}
        backends={backends}
        selectedBackendId={backendId}
        onSelectBackend={setBackendId}
        projectMlBackendId={projectMlBackendId}
      />

      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          父框类别（逗号分隔，留空=对全部父框跑）
        </span>
        <input
          className={styles.textInput}
          value={classFilter}
          placeholder="car, truck"
          onChange={(e) => setClassFilter(e.target.value)}
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
          写回属性键（逗号分隔，留空=接收下游返回的全部键）
        </span>
        <input
          className={styles.textInput}
          value={writeKeys}
          placeholder="color, vehicle_type"
          onChange={(e) => setWriteKeys(e.target.value)}
        />
      </div>
    </div>
  );
}
