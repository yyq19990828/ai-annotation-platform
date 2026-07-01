// v0.20.11 · 选中框单框二次推理入口 (Q1b)。
//
// 选中单个已落库标注框时, 浮在画布顶部居中 (与 InteractiveToolBar 同风格、互斥: 那个只在 AI
// 工具激活时显)。列出该框可跑的能力 (跨启用 backend, supported_inputs 含 crop): 检测子物 / 分类
// 属性 / OCR。选一个 → 运行 → 属性写回原框 (带 AI 溯源 chip)、几何建子框 (侧栏缩进)。
// 无可跑能力时不渲染 (不占位)。
// v0.20.16-ui · 借鉴 InteractiveToolBar 悬浮面板: 能力用按 task 分组的 <select> 收成一个下拉
// (取代平铺一大坨按钮), 选中项旁给 ⚙ 参数 / ⚠ 补字段, 右侧「运行」。有参数时下方展开 SchemaForm。
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import type { AttributeField } from "@/api/projects";
import type { AnnotationResponse } from "@/types";
import { displayClassName } from "../stage/colors";
import {
  SchemaForm,
  deriveDefaults,
  type JsonSchemaObject,
} from "../components/SchemaForm";
import {
  buildSecondaryInferencePayload,
  hasConfigurableParams,
  missingAttributeFields,
  useRunSecondaryInference,
  useSecondaryCapabilities,
  type SecondaryCapability,
} from "../state/useSecondaryInference";

interface Props {
  projectId: string | undefined;
  taskId: string;
  annotation: AnnotationResponse;
  readOnly?: boolean;
  /** v0.20.12 · 项目已有属性键: 判定 attributes-型能力的输出键是否有承接位 (无则产物看不见)。 */
  existingAttributeKeys?: Set<string>;
  /** v0.20.12 · 一次把缺失属性字段补进项目 (复用工作台属性补全)。 */
  onEnsureAttributeFields?: (fields: AttributeField[]) => void;
}

// 与 InteractiveToolBar 同款样式常量, 保持悬浮面板视觉一致。
const FIELD_LABEL_CLASS = "text-2xs text-muted-foreground";
const SELECT_CLASS =
  "appearance-none rounded-sm border border-border bg-muted px-1.5 py-1 text-xs text-foreground";
const DIVIDER = <span aria-hidden className="h-5 w-px bg-border" />;

const TASK_LABELS: Record<string, string> = {
  detection: "检测",
  obb: "旋转框检测",
  segmentation: "分割",
  instance_segmentation: "分割",
  keypoint: "关键点",
  pose: "关键点",
  classification: "分类",
  cls: "分类",
  ocr: "文字识别",
  doc_layout: "版面分析",
};
const taskLabel = (t: string | null | undefined) =>
  (t && TASK_LABELS[t.toLowerCase()]) || "其他";

const capKey = (c: SecondaryCapability) => `${c.backendId}:${c.model.id}`;

const TARGET_HINT: Record<SecondaryCapability["writeTarget"], string> = {
  attributes: "属性写回原框",
  geometry: "检出建子框",
};

/** 按 task 把能力分桶, 保持原始顺序; 返回 [task, caps[]] 供 <optgroup> 渲染。 */
function groupByTask(
  caps: SecondaryCapability[],
): Array<[string, SecondaryCapability[]]> {
  const order: string[] = [];
  const buckets = new Map<string, SecondaryCapability[]>();
  for (const c of caps) {
    const t = c.model.task ?? "";
    if (!buckets.has(t)) {
      buckets.set(t, []);
      order.push(t);
    }
    buckets.get(t)!.push(c);
  }
  return order.map((t) => [t, buckets.get(t)!]);
}

export function SecondaryInferenceBar({
  projectId,
  taskId,
  annotation,
  readOnly,
  existingAttributeKeys,
  onEnsureAttributeFields,
}: Props) {
  const pushToast = useToastStore((s) => s.push);
  const { capabilities } = useSecondaryCapabilities(projectId);
  const run = useRunSecondaryInference(taskId);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // v0.20.13 · 每能力的推理参数 (阈值等); paramsOpen = 当前是否展开选中能力的参数面板。
  const [paramsByKey, setParamsByKey] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [paramsOpen, setParamsOpen] = useState(false);

  if (readOnly || capabilities.length === 0) return null;

  const existing = existingAttributeKeys ?? new Set<string>();
  // 选中能力: 用户选过的; 未选/失效则回落首个。
  const selected =
    capabilities.find((c) => capKey(c) === selectedKey) ?? capabilities[0];
  const selKey = capKey(selected);
  const busy = runningKey !== null;
  const missing = missingAttributeFields(selected, existing);
  const canParams = hasConfigurableParams(selected.model);

  const openParamsFor = (cap: SecondaryCapability) => {
    setParamsOpen((v) => !v);
    setParamsByKey((prev) =>
      prev[capKey(cap)]
        ? prev
        : {
            ...prev,
            [capKey(cap)]: deriveDefaults(cap.model.params as JsonSchemaObject),
          },
    );
  };

  const onRun = async (cap: SecondaryCapability) => {
    const key = capKey(cap);
    setRunningKey(key);
    try {
      const resp = await run.mutateAsync({
        annotationId: annotation.id,
        body: buildSecondaryInferencePayload(cap, paramsByKey[key]),
      });
      const childCount = resp.created_children.length;
      const attrKeys = Object.keys(resp.annotation.attributes_meta ?? {});
      // 写了但项目缺承接字段 → 属性面板看不见, 提示去补全 (避免"跑了没反应")。
      const invisible = attrKeys.filter((k) => !existing.has(k));
      const sub =
        cap.writeTarget === "geometry"
          ? childCount > 0
            ? `新增 ${childCount} 个子框`
            : "未检出子物"
          : attrKeys.length > 0
            ? invisible.length > 0
              ? `写回 ${attrKeys.length} 项, 其中 ${invisible.length} 项项目缺字段 (面板不显示, 请补全)`
              : `写回 ${attrKeys.length} 项属性`
            : "无属性产出";
      const produced =
        cap.writeTarget === "geometry" ? childCount > 0 : attrKeys.length > 0;
      pushToast({
        msg: `${cap.label} 已完成`,
        sub,
        kind:
          cap.writeTarget === "attributes" && invisible.length > 0
            ? "warning"
            : produced
              ? "success"
              : "",
      });
    } catch (err) {
      pushToast({
        msg: `${cap.label} 二次推理失败`,
        sub: String((err as Error)?.message ?? err),
        kind: "error",
      });
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <div
      data-testid="secondary-inference-bar"
      className="absolute left-1/2 top-3 z-local-5 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col gap-1 rounded-md border border-border bg-card px-3 py-1.5 shadow-md"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2.5">
        {/* 标题 */}
        <div className="flex items-center gap-1.5">
          <b className="text-xs">
            <span className="text-brand">✦</span> 二次推理
          </b>
          <span className={FIELD_LABEL_CLASS}>
            「{displayClassName(annotation.class_name)}」框
          </span>
        </div>

        {DIVIDER}

        {/* 能力: 按 task 分组的下拉 (取代平铺按钮) */}
        <div className="flex items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>能力</span>
          <select
            data-testid="secondary-cap-select"
            value={selKey}
            disabled={busy}
            onChange={(e) => {
              setSelectedKey(e.target.value);
              setParamsOpen(false);
            }}
            className={`${SELECT_CLASS} cursor-pointer`}
            title="选择要在框 ROI 上跑的能力"
          >
            {groupByTask(capabilities).map(([task, group]) => (
              <optgroup key={task} label={taskLabel(task)}>
                {group.map((c) => (
                  <option key={capKey(c)} value={capKey(c)}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className={FIELD_LABEL_CLASS}>{TARGET_HINT[selected.writeTarget]}</span>
          {canParams && (
            <button
              type="button"
              onClick={() => openParamsFor(selected)}
              disabled={busy}
              title="推理参数 (阈值等)"
              data-testid="secondary-params-toggle"
              aria-pressed={paramsOpen}
              className={`flex size-6 items-center justify-center rounded-sm border border-border text-xs ${paramsOpen ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            >
              ⚙
            </button>
          )}
          {missing.length > 0 && onEnsureAttributeFields && (
            <button
              type="button"
              onClick={() => onEnsureAttributeFields(missing)}
              disabled={busy}
              title={`该模型会输出 ${missing.map((f) => f.key).join(", ")}，但项目缺承接字段（跑了也不显示）。点此补全。`}
              data-testid="secondary-fill"
              className="rounded-sm border border-amber-400/60 px-1.5 py-1 text-2xs text-amber-600 dark:text-amber-400"
            >
              ⚠ 补 {missing.length} 字段
            </button>
          )}
        </div>

        {DIVIDER}

        <Button
          size="sm"
          variant="ai"
          disabled={busy}
          onClick={() => onRun(selected)}
          title={`${selected.backendName} · ${TARGET_HINT[selected.writeTarget]}`}
          data-testid="secondary-run"
        >
          {busy ? "运行中…" : "运行"}
        </Button>
      </div>

      {paramsOpen && canParams && (
        <div
          className="max-h-64 overflow-y-auto border-t border-border pt-1"
          data-testid="secondary-params-panel"
        >
          <SchemaForm
            schema={selected.model.params as JsonSchemaObject}
            value={paramsByKey[selKey] ?? {}}
            onChange={(next) =>
              setParamsByKey((prev) => ({ ...prev, [selKey]: next }))
            }
            disabled={busy}
          />
        </div>
      )}
    </div>
  );
}
