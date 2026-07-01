// v0.20.11 · 选中框单框二次推理入口 (Q1b)。
//
// 选中单个已落库标注框时, 浮在画布顶部居中 (与 InteractiveToolBar 同风格、互斥: 那个只在 AI
// 工具激活时显)。列出该框可跑的能力 (跨启用 backend, supported_inputs 含 crop): 检测子物 / 分类
// 属性 / OCR。点击 → 在框 ROI 上同步跑 → 属性写回原框 (带 AI 溯源 chip)、几何建子框 (侧栏缩进)。
// 无可跑能力时不渲染 (不占位)。
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import type { AttributeField } from "@/api/projects";
import type { AnnotationResponse } from "@/types";
import { displayClassName } from "../stage/colors";
import {
  buildSecondaryInferencePayload,
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
  /** v0.20.12 · 一次把缺失属性字段补进项目 (复用 v0.20.2 补全)。 */
  onEnsureAttributeFields?: (fields: AttributeField[]) => void;
}

const TARGET_HINT: Record<SecondaryCapability["writeTarget"], string> = {
  attributes: "属性写回原框",
  geometry: "检出建子框",
};

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

  if (readOnly || capabilities.length === 0) return null;

  const existing = existingAttributeKeys ?? new Set<string>();

  const onRun = async (cap: SecondaryCapability) => {
    const key = `${cap.backendId}:${cap.model.id}`;
    setRunningKey(key);
    try {
      const resp = await run.mutateAsync({
        annotationId: annotation.id,
        body: buildSecondaryInferencePayload(cap),
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
        kind: cap.writeTarget === "attributes" && invisible.length > 0
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
      className="absolute left-1/2 top-3 z-local-5 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 shadow-md"
    >
      <span className="text-2xs text-muted-foreground">
        对「{displayClassName(annotation.class_name)}」框二次推理
      </span>
      {capabilities.map((cap) => {
        const key = `${cap.backendId}:${cap.model.id}`;
        const busy = runningKey === key;
        // attributes-型: 该能力会写、但项目缺承接字段 → 产物写库却不显示, 给「补全」预警。
        const missing = missingAttributeFields(cap, existing);
        return (
          <span key={key} className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="default"
              disabled={runningKey !== null}
              onClick={() => onRun(cap)}
              title={`${cap.backendName} · ${TARGET_HINT[cap.writeTarget]}`}
              data-testid={`secondary-cap-${key}`}
            >
              {busy ? "运行中…" : cap.label}
            </Button>
            {missing.length > 0 && onEnsureAttributeFields && (
              <Button
                size="sm"
                variant="ghost"
                disabled={runningKey !== null}
                onClick={() => onEnsureAttributeFields(missing)}
                title={`该模型会输出 ${missing
                  .map((f) => f.key)
                  .join(", ")}，但项目缺承接字段（跑了也不显示）。点此补全。`}
                data-testid={`secondary-fill-${key}`}
                className="text-amber-600 dark:text-amber-400"
              >
                ⚠ 补 {missing.length} 字段
              </Button>
            )}
          </span>
        );
      })}
    </div>
  );
}
