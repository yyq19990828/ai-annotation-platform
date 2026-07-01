// v0.20.11 · 选中框单框二次推理 (Q1b) 前端 hook。
//
// - useSecondaryCapabilities: 枚举本项目启用的 backend × model, 过滤出「能在 crop 上跑」
//   的能力 (supported_inputs 含 crop、非交互), 派生 writeTarget (检测→geometry / 分类·OCR→attributes)。
// - useRunSecondaryInference: 调后端 secondary-inference 端点, 落库后 invalidate 标注列表刷新画布/侧栏。
import { useMemo } from "react";
import {
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { mlBackendsApi, type MLModelCapability } from "@/api/ml-backends";
import { tasksApi, type SecondaryInferenceRequest } from "@/api/tasks";
import { useMLBackends } from "@/hooks/useMLBackends";

export interface SecondaryCapability {
  backendId: string;
  backendName: string;
  model: MLModelCapability;
  writeTarget: "attributes" | "geometry";
  /** 展示标签: 模型名 (含 task)。 */
  label: string;
}

const GEOMETRY_TASKS = new Set([
  "detection",
  "segmentation",
  "instance_segmentation",
  "obb",
  "keypoint",
  "pose",
]);
const ATTRIBUTE_TASKS = new Set(["classification", "cls", "ocr", "doc_layout"]);

function deriveWriteTarget(
  m: MLModelCapability,
): "attributes" | "geometry" | null {
  const task = (m.task ?? "").toLowerCase();
  if (GEOMETRY_TASKS.has(task)) return "geometry";
  if (ATTRIBUTE_TASKS.has(task)) return "attributes";
  // 回落: 按输出形态推断 (backend 未报标准 task 名时)。
  if ((m.output_attribute_schema?.length ?? 0) > 0) return "attributes";
  if ((m.supported_geometric_outputs?.length ?? 0) > 0) return "geometry";
  return null;
}

/** 该 model 能否在选中框 ROI (crop) 上跑: 非交互 + supported_inputs 含 crop。 */
function isCropRunnable(m: MLModelCapability): boolean {
  if (m.is_interactive) return false;
  return (m.supported_inputs ?? []).includes("crop");
}

/**
 * 枚举本项目「选中框可跑」的二次推理能力 (跨启用 backend)。
 * 逐 backend 拉 capabilities (react-query 复用 ["ml-backends", projectId, backendId, "capabilities"]
 * 缓存, 与预标页共享)。
 */
export function useSecondaryCapabilities(projectId: string | undefined): {
  capabilities: SecondaryCapability[];
  isLoading: boolean;
} {
  const backendsQ = useMLBackends(projectId);
  const backends = backendsQ.data ?? [];

  const capabilityQueries = useQueries({
    queries: backends.map((b) => ({
      queryKey: ["ml-backends", projectId, b.id, "capabilities"],
      queryFn: () => mlBackendsApi.capabilities(projectId!, b.id),
      enabled: !!projectId,
      staleTime: 60_000,
    })),
  });

  const capabilities = useMemo<SecondaryCapability[]>(() => {
    const out: SecondaryCapability[] = [];
    capabilityQueries.forEach((q, i) => {
      const backend = backends[i];
      if (!backend || !q.data) return;
      for (const m of q.data.models ?? []) {
        if (!isCropRunnable(m)) continue;
        const writeTarget = deriveWriteTarget(m);
        if (!writeTarget) continue;
        out.push({
          backendId: backend.id,
          backendName: backend.name,
          model: m,
          writeTarget,
          label: m.display_name || m.id,
        });
      }
    });
    return out;
    // capabilityQueries 每渲染新数组, 用其 data 指纹稳定依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backends, capabilityQueries.map((q) => q.data).join(",")]);

  return {
    capabilities,
    isLoading: backendsQ.isLoading || capabilityQueries.some((q) => q.isLoading),
  };
}

/** 把一个能力 + 目标框拼成 secondary-inference 请求。 */
export function buildSecondaryInferencePayload(
  cap: SecondaryCapability,
): SecondaryInferenceRequest {
  const m = cap.model;
  // attributes: 只取 backend 声明的输出属性键; 空 → null (=全取, 别发空数组致后端过滤成空)。
  const attrKeys = (m.output_attribute_schema ?? [])
    .map((f) => f.key)
    .filter(Boolean);
  return {
    ml_backend_id: cap.backendId,
    write_target: cap.writeTarget,
    model_id: m.id,
    // 几何 backend (yolo/onnxtools) 走协议 v2 需 model_variants (非 null); 分类/OCR 扁平路径 null。
    model_variants:
      cap.writeTarget === "geometry" ? (m.default_variants ?? {}) : null,
    task_type: m.task ?? null,
    write_keys:
      cap.writeTarget === "attributes" && attrKeys.length > 0 ? attrKeys : null,
  };
}

/** 运行单框二次推理; 成功后刷新该 task 的标注列表 (画布 + 侧栏自动重渲染)。 */
export function useRunSecondaryInference(taskId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      annotationId,
      body,
    }: {
      annotationId: string;
      body: SecondaryInferenceRequest;
    }) => tasksApi.secondaryInference(taskId!, annotationId, body),
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: ["annotations", taskId] });
    },
  });
}
