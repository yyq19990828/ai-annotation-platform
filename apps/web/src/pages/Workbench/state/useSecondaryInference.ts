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
import type { AttributeField } from "@/api/projects";
import { tasksApi, type SecondaryInferenceRequest } from "@/api/tasks";
import { useMLBackends } from "@/hooks/useMLBackends";
import { isVariantField } from "../components/SchemaForm";

const ALLOWED_ATTR_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "range",
];

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

/** 该能力是否有可调推理参数 (params.properties 里除变体字段外还有别的)。 */
export function hasConfigurableParams(m: MLModelCapability): boolean {
  const props = m.params?.properties;
  if (!props) return false;
  return Object.entries(props).some(
    ([key, raw]) =>
      !isVariantField(key, (raw ?? {}) as Parameters<typeof isVariantField>[1]),
  );
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

/**
 * 该 attributes-型能力会写、但项目 attribute_schema 缺承接位的字段 (转成可「一键补全」的
 * AttributeField)。用于 SecondaryInferenceBar 预警「跑了属性也看不见」并提供补全。
 * 转换逻辑与 useCapabilityValidation 的 v0.20.2 补全载荷同款。
 */
export function missingAttributeFields(
  cap: SecondaryCapability,
  existingKeys: Set<string>,
): AttributeField[] {
  if (cap.writeTarget !== "attributes") return [];
  const out: AttributeField[] = [];
  for (const item of cap.model.output_attribute_schema ?? []) {
    if (!item.key || existingKeys.has(item.key)) continue;
    const type = (
      ALLOWED_ATTR_TYPES.includes(item.type) ? item.type : "text"
    ) as AttributeField["type"];
    out.push({
      key: item.key,
      label: item.label || item.key,
      type,
      required: false,
      ...(item.options?.length
        ? { options: item.options.map((o) => ({ value: o.value, label: o.label })) }
        : {}),
    });
  }
  return out;
}

/** 模型默认档位叠加用户所选 (只取 string 值; 缺轴回落默认), 产出协议 v2 的 model_variants。 */
function mergeVariants(
  defaults: Record<string, string> | null | undefined,
  picked: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...(defaults ?? {}) };
  for (const [k, v] of Object.entries(picked ?? {})) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * 把一个能力 + 目标框拼成 secondary-inference 请求。
 * `params` 为用户在参数面板 (SchemaForm) 调过的推理参数 (阈值等); 空则不带 (后端用模型默认)。
 * `variants` 为用户在变体下拉选过的模型档位 (series/size 等); 与模型默认档位合并 (用户所选覆盖),
 *   缺则回落模型 default_variants。仅几何能力走 model_variants (分类/OCR 扁平路径恒 null)。
 */
export function buildSecondaryInferencePayload(
  cap: SecondaryCapability,
  params?: Record<string, unknown>,
  variants?: Record<string, unknown>,
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
    // 用户所选档位覆盖模型默认 (缺轴回落默认), 与交互条 interactiveVariantSlice 同语义。
    model_variants:
      cap.writeTarget === "geometry"
        ? mergeVariants(m.default_variants, variants)
        : null,
    task_type: m.task ?? null,
    write_keys:
      cap.writeTarget === "attributes" && attrKeys.length > 0 ? attrKeys : null,
    params: params && Object.keys(params).length > 0 ? params : null,
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
