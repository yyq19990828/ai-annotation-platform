// v0.16.x 第 3 批 · 从 ThreeDWorkbench 抽出的 PSR 数值字段防抖落库管线。
// 改 PSR 数值面板 → parsePsrForm 校验 → 250ms 防抖 → PATCH 几何 + 入 history。
// 这是 PSR 编辑里唯一单一职责、单消费者(handleField)且不碰共享 form/setForm 的部分:
// 完整 usePsrEditor 因 form/setForm 被 gizmo handler / 一键操作 / 浮窗 commit / 渲染等
// 8 处共享(假边界)而无法干净切分,按计划 §7 "缩小范围" 只抽此管线。逐字搬运,行为零变化。
//
// 与 B 类其余 3D 簇不同:本管线无 Three.js/WebGL 依赖,可 fake timers 单测。
import { useCallback, useEffect, useRef } from "react";
import type { AnnotationResponse } from "@/types";
import type { useUpdateAnnotation } from "@/hooks/useTasks";
import {
  geometryConvention,
  parsePsrForm,
  psrFormToGeometry,
  type PsrField,
} from "./ThreeDWorkbench.helpers";
import type { LidarAxisConvention } from "./geometry/axisConvention";
import type { useThreeDHistory } from "./useThreeDHistory";

interface UsePsrPatchPipelineParams {
  selectedId: string | null;
  selectedAnn: AnnotationResponse | null;
  axisConvention: LidarAxisConvention;
  updateAnnotation: ReturnType<typeof useUpdateAnnotation>;
  history: ReturnType<typeof useThreeDHistory>;
}

export function usePsrPatchPipeline({
  selectedId,
  selectedAnn,
  axisConvention,
  updateAnnotation,
  history,
}: UsePsrPatchPipelineParams) {
  const patchTimer = useRef<number | null>(null);

  // 卸载时清防抖定时器。
  useEffect(
    () => () => {
      if (patchTimer.current) window.clearTimeout(patchTimer.current);
    },
    [],
  );

  // 全部字段解析有效(尺寸>0)时防抖 PATCH;有空 / 非法字段则暂不提交(等用户输完)。
  const schedulePatch = useCallback(
    (f: Record<PsrField, string>) => {
      if (!selectedId) return;
      const { values: v, valid } = parsePsrForm(f);
      if (!valid) return;
      if (patchTimer.current) window.clearTimeout(patchTimer.current);
      patchTimer.current = window.setTimeout(() => {
        const geometry = psrFormToGeometry(
          v,
          geometryConvention(selectedAnn?.geometry, axisConvention),
        );
        updateAnnotation.mutate({ annotationId: selectedId, payload: { geometry } });
        if (selectedAnn?.geometry?.type === "box_3d") {
          history.push({
            kind: "update",
            annotationId: selectedId,
            before: { geometry: selectedAnn.geometry },
            after: { geometry },
          });
        }
      }, 250);
    },
    [selectedId, updateAnnotation, selectedAnn?.geometry, axisConvention, history],
  );

  return { schedulePatch };
}
