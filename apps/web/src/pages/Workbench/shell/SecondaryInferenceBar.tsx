// v0.20.11 · 选中框单框二次推理入口 (Q1b)。
//
// 选中单个已落库标注框时, 浮在画布顶部居中 (与 InteractiveToolBar 同风格、互斥: 那个只在 AI
// 工具激活时显)。列出该框可跑的能力 (跨启用 backend, supported_inputs 含 crop): 检测子物 / 分类
// 属性 / OCR。选一个 → 运行 → 属性写回原框 (带 AI 溯源 chip)、几何建子框 (侧栏缩进)。
// 无可跑能力时不渲染 (不占位)。
// v0.20.16-ui · 借鉴 InteractiveToolBar 悬浮面板: 能力用按 task 分组的 <select> 收成一个下拉
// (取代平铺一大坨按钮), 选中项旁给 ⚙ 参数 / ⚠ 补字段, 右侧「运行」。有参数时下方展开 SchemaForm。
// v0.20.17 · 几何能力加模型档位下拉 (复用交互条 VariantSelector); 参数 + 变体按 backendId:modelId
// 持久化到用户偏好 (useSecondaryParamPrefs), 切框/刷新/换设备保留上次值。
// v0.20.18 · 开集(开放词表)检测/分割模型 (supported_prompts 含 text) 加目标文本输入 (空则禁运行);
// 参数面板改为 ⚙ 下方的独立 popover (固定列宽, 不随工具条变宽被拉满); ⚙ 用 Icon settings 替 emoji。
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { VariantSelector } from "@/components/ml/VariantSelector";
import type { AttributeField } from "@/api/projects";
import type { AnnotationResponse } from "@/types";
import { displayClassName } from "../stage/colors";
import { SchemaForm, deriveDefaults, type JsonSchemaObject } from "../components/SchemaForm";
import {
  buildSecondaryInferencePayload,
  hasConfigurableParams,
  missingAttributeFields,
  needsTextPrompt,
  useRunSecondaryInference,
  useSecondaryCapabilities,
  type SecondaryCapability,
} from "../state/useSecondaryInference";
import { useSecondaryParamPrefs } from "../state/useSecondaryParamPrefs";

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
// whitespace-nowrap + shrink-0: 标签不被 flex 挤压逐字竖排, 面板按内容自适应加宽。
const FIELD_LABEL_CLASS = "shrink-0 whitespace-nowrap text-2xs text-muted-foreground";
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
const taskLabel = (t: string | null | undefined) => (t && TASK_LABELS[t.toLowerCase()]) || "其他";

const capKey = (c: SecondaryCapability) => `${c.backendId}:${c.model.id}`;

const TARGET_HINT: Record<SecondaryCapability["writeTarget"], string> = {
  attributes: "属性写回原框",
  geometry: "检出建子框",
};

/** 按 task 把能力分桶, 保持原始顺序; 返回 [task, caps[]] 供 <optgroup> 渲染。 */
function groupByTask(caps: SecondaryCapability[]): Array<[string, SecondaryCapability[]]> {
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
  const [paramsByKey, setParamsByKey] = useState<Record<string, Record<string, unknown>>>({});
  // v0.20.17 · 每能力已选的模型变体档位 (series/size 等); 与 default_variants 合并成实际下发档位。
  const [variantByKey, setVariantByKey] = useState<Record<string, Record<string, unknown>>>({});
  // v0.20.18 · 开集文本模型的查询文本 (按能力); 每次运行的临时查询, 不持久化。
  const [promptByKey, setPromptByKey] = useState<Record<string, string>>({});
  const [paramsOpen, setParamsOpen] = useState(false);
  // v0.20.17 · 用户级偏好 (按 backendId:modelId): 参数 + 变体跨框/跨设备记住。
  const { byModel, loaded: prefsLoaded, save: savePref } = useSecondaryParamPrefs();

  // 偏好载入后, 把存过的 params/variants 灌进组件 state (仅未触碰的键, 不覆盖当前编辑)。
  useEffect(() => {
    if (!prefsLoaded) return;
    setParamsByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, entry] of Object.entries(byModel)) {
        if (!(k in next) && entry.params) {
          next[k] = entry.params;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setVariantByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, entry] of Object.entries(byModel)) {
        if (!(k in next) && entry.variants) {
          next[k] = entry.variants;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [prefsLoaded, byModel]);

  if (readOnly || capabilities.length === 0) return null;

  const existing = existingAttributeKeys ?? new Set<string>();
  // 选中能力: 用户选过的; 未选/失效则回落首个。
  const selected = capabilities.find((c) => capKey(c) === selectedKey) ?? capabilities[0];
  const selKey = capKey(selected);
  const busy = runningKey !== null;
  const missing = missingAttributeFields(selected, existing);
  const canParams = hasConfigurableParams(selected.model);
  // v0.20.18 · 开集文本模型: 需用户输入检测/分割目标文本; 空文本禁运行 (跑了也检不出)。
  const wantsText = needsTextPrompt(selected);
  const promptMissing = wantsText && !(promptByKey[selKey] ?? "").trim();

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
        body: buildSecondaryInferencePayload(
          cap,
          paramsByKey[key],
          variantByKey[key],
          promptByKey[key],
        ),
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
      const produced = cap.writeTarget === "geometry" ? childCount > 0 : attrKeys.length > 0;
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
        <div className="flex shrink-0 items-center gap-1.5">
          <b className="whitespace-nowrap text-xs">
            <span className="text-brand">✦</span> 二次推理
          </b>
          <span className={FIELD_LABEL_CLASS}>「{displayClassName(annotation.class_name)}」框</span>
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
          {/* 模型档位下拉 (复用交互条同款紧凑变体选择器)。门开在「模型声明了变体轴」而非
              「写几何」——OCR 等属性能力 (如 rapidocr rec/e2e 的 version/size/lang 轴) 同样要能选档;
              无变体轴的能力 (onnxtools 分类) 不渲染。 */}
          {(selected.model.supported_variants?.length ?? 0) > 0 && (
            <VariantSelector
              compact
              supportedVariants={selected.model.supported_variants}
              variantCombinations={selected.model.variant_combinations}
              defaults={selected.model.default_variants ?? {}}
              value={variantByKey[selKey] ?? {}}
              disabled={busy}
              onChange={(next) => {
                setVariantByKey((prev) => ({ ...prev, [selKey]: next }));
                savePref(selKey, { variants: next });
              }}
            />
          )}
          {canParams && (
            <div className="relative">
              <button
                type="button"
                onClick={() => openParamsFor(selected)}
                disabled={busy}
                title="推理参数 (阈值等)"
                data-testid="secondary-params-toggle"
                aria-pressed={paramsOpen}
                className={`flex size-6 items-center justify-center rounded-sm border border-border ${paramsOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon name="settings" size={14} />
              </button>
              {/* v0.20.18 · 参数以独立 popover 弹在 ⚙ 下方 (不再挂工具条底部被拉宽);
                  固定列宽, 与工具条宽度无关。 */}
              {paramsOpen && (
                <div
                  className="absolute right-0 top-full z-local-2 mt-1 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg [&_select]:self-start"
                  data-testid="secondary-params-panel"
                >
                  <SchemaForm
                    schema={selected.model.params as JsonSchemaObject}
                    value={paramsByKey[selKey] ?? {}}
                    onChange={(next) => {
                      setParamsByKey((prev) => ({ ...prev, [selKey]: next }));
                      savePref(selKey, { params: next });
                    }}
                    disabled={busy}
                  />
                </div>
              )}
            </div>
          )}
          {missing.length > 0 && onEnsureAttributeFields && (
            <button
              type="button"
              onClick={() => onEnsureAttributeFields(missing)}
              disabled={busy}
              title={`该模型会输出 ${missing.map((f) => f.key).join(", ")}，但项目缺承接字段（跑了也不显示）。点此补全。`}
              data-testid="secondary-fill"
              className="rounded-sm border border-amber-400/60 px-1.5 py-1 text-2xs text-status-caution"
            >
              ⚠ 补 {missing.length} 字段
            </button>
          )}
        </div>

        {/* v0.20.18 · 开集(开放词表)检测/分割: 需输入目标文本 (如 car . person)。 */}
        {wantsText && (
          <>
            {DIVIDER}
            <div className="flex shrink-0 items-center gap-1.5">
              <span className={FIELD_LABEL_CLASS}>文本</span>
              <input
                type="text"
                value={promptByKey[selKey] ?? ""}
                disabled={busy}
                onChange={(e) => setPromptByKey((prev) => ({ ...prev, [selKey]: e.target.value }))}
                placeholder="如 car . person"
                title="开集模型的检测/分割目标文本 (多个用 . 分隔)"
                data-testid="secondary-prompt"
                className="w-40 rounded-sm border border-border bg-muted px-1.5 py-1 text-xs text-foreground"
              />
            </div>
          </>
        )}

        {DIVIDER}

        <Button
          size="sm"
          variant="ai"
          disabled={busy || promptMissing}
          onClick={() => onRun(selected)}
          title={
            promptMissing
              ? "请先输入检测/分割目标文本"
              : `${selected.backendName} · ${TARGET_HINT[selected.writeTarget]}`
          }
          data-testid="secondary-run"
        >
          {busy ? "运行中…" : "运行"}
        </Button>
      </div>
    </div>
  );
}
