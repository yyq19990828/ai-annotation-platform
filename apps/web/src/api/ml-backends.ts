import { apiClient } from "./client";
import type { MLBackendResponse } from "@/types";
import type { OutputAttributeSchemaItem } from "./mlCapabilities";

export interface MLBackendCreatePayload {
  name: string;
  url: string;
  is_interactive?: boolean;
  auth_method?: string;
  auth_token?: string;
  extra_params?: Record<string, unknown>;
}

export type MLBackendUpdatePayload = Partial<MLBackendCreatePayload>;

export interface InteractiveRequest {
  task_id: string;
  context: Record<string, unknown>;
}

export type MLBackendVariant = Record<string, string>;

export interface MLBackendSupportedVariantOption {
  value: string;
  label?: string;
  vram_gb?: number;
  tier?: "fast" | "balanced" | "accurate" | string;
  recommended?: boolean;
  note?: string;
}

export interface MLBackendSupportedVariantGroup {
  key: string;
  title?: string;
  description?: string;
  variants?: MLBackendSupportedVariantOption[];
}

// v0.14.9 · 能力声明协议 v2 — 单个 model 条目 (一个 backend 暴露 N 个).
// `task` 是条目边界 (det/seg/pose/obb/cls/ocr/doc_layout/...), 决定输出几何与项目兼容性;
// `infra` 缺省继承 backend 默认; series/size 复用 supported_variants 多轴.
export interface MLModelCapability {
  id: string;
  display_name?: string;
  task?: string;
  model_family?: string;
  // 原子 vs 内部编排 (协议 v2.2): atom=单次推理原子; composite=一个 model 内部串多原子.
  // 缺省/老 backend = atom. 模型市场据此打「原子/内置流程」徽标; 编排下游 stage 只收 atom.
  composition?: "atom" | "composite";
  infra?: string;
  is_interactive?: boolean;
  supported_prompts?: string[];
  supported_geometric_outputs?: string[];
  output_attribute_types?: string[];
  // v0.18.0 · backend 自报输出属性 schema (含 select options); 二阶段 backend (onnxtools
  // 车辆属性) 声明 /predict 会写哪些 attributes。`/capabilities` 经 ModelCapability 透传。
  // 多阶段预标 StageCard 的「写回属性键」多选据此列选项。老 backend 缺字段 = 无属性输出。
  output_attribute_schema?: OutputAttributeSchemaItem[];
  supported_text_outputs?: string[];
  supported_trackers?: string[];
  supported_variants?: MLBackendSupportedVariantGroup[];
  // v0.14.12 · 显式合法组合 (可选): backend 多 axis 非真笛卡尔积时使用. yolo 的
  // (series, size) 受 MODEL_MATRIX 约束 (rtdetr 只有 l/x; v9 detect 仅 t/s/m/c/e),
  // 必须列举合法组合避免目录展示虚假权重. 字段缺省时前端按 axes 笛卡尔积处理.
  // 每条 inner array 与 supported_variants 轴顺序一致, 即 [axis0_value, axis1_value, ...].
  variant_combinations?: string[][];
  // v0.14.12 · True 表示同 backend 内多 task 共享同一份物理权重 (gsam2 风格);
  // False/缺省表示每 task 独立权重 (yolo 风格). 前端列表据此切换渲染策略。
  variants_shared_across_tasks?: boolean;
  // v0.14.13 · backend 自报的默认 variant 组合 (dict[axis_key, value]).
  // 前端 VariantSelector 在用户未选时取此作初值; 优先级:
  // 项目级 project.default_variants[backend_id] > 本字段 > backend 启动 env 默认.
  default_variants?: Record<string, string>;
  default_thresholds?: Record<string, unknown>;
  resource_profile?: Record<string, unknown>;
  params?: { type?: string; properties?: Record<string, unknown> };
  modality?: string;
  // v0.14.17 · 模型原生类别表 (闭集检测器, 读自权重 model.names). 供前端渲染类别白名单勾选;
  // 仅在该 task 模型已加载过 (warmup / 首次 predict 后) 时有值。
  classes?: { index: number; name: string }[];
}

// v0.10.1 · /setup 协议自描述响应 (与后端 sam3/grounded-sam2 main.py 同构).
// `params` 为 JSON Schema (Draft-07 子集), M2 schema-form 据此渲染参数面板.
export interface MLBackendCapability {
  name: string;
  version?: string;
  protocol_version?: string;
  compat_protocol_versions?: string[];
  model_version?: string;
  is_interactive?: boolean;
  labels?: string[];
  supported_prompts: string[];
  supported_text_outputs?: string[];
  supported_geometric_outputs?: string[];
  // v0.10.36 · 支持的视频 tracker 列表 (如 ["sam2_video"]); 空/缺 = 不支持视频追踪.
  supported_trackers?: string[];
  // v0.10.40 · 变体富元数据; 缺失时前端回落 params.*_variant.enum.
  supported_variants?: MLBackendSupportedVariantGroup[];
  params?: {
    type?: string;
    properties?: Record<string, unknown>;
  };
  // v0.14.9 · 能力声明协议 v2: backend 默认 infra + 多模型目录.
  // 老 backend 缺省时由平台合成「隐式单 model」(见 capabilities 端点).
  infra?: string;
  // v0.14.14 · backend 自报是否支持 POST /warmup (协议 §4.4); 老 backend 缺字段 = false.
  warmup_endpoint?: boolean;
  models?: MLModelCapability[];
  // capabilities 端点 (health_meta 派生) 会带派生模态; 原始 /setup 不带.
  modalities?: string[];
}

export const mlBackendsApi = {
  list: (projectId: string) =>
    apiClient.get<MLBackendResponse[]>(`/projects/${projectId}/ml-backends`),

  setup: (projectId: string, backendId: string) =>
    apiClient.get<MLBackendCapability>(`/projects/${projectId}/ml-backends/${backendId}/setup`),

  // v0.14.9 · 能力目录 (health_meta 派生视图, 含 models[] + infra + modalities).
  capabilities: (projectId: string, backendId: string) =>
    apiClient.get<MLBackendCapability>(
      `/projects/${projectId}/ml-backends/${backendId}/capabilities`,
    ),

  // v0.14.9 · 强制重探 /setup 并刷新能力目录缓存.
  refreshCapabilities: (projectId: string, backendId: string) =>
    apiClient.post<MLBackendCapability>(
      `/projects/${projectId}/ml-backends/${backendId}/capabilities/refresh`,
    ),

  create: (projectId: string, payload: MLBackendCreatePayload) =>
    apiClient.post<MLBackendResponse>(`/projects/${projectId}/ml-backends`, payload),

  get: (projectId: string, backendId: string) =>
    apiClient.get<MLBackendResponse>(`/projects/${projectId}/ml-backends/${backendId}`),

  update: (projectId: string, backendId: string, payload: MLBackendUpdatePayload) =>
    apiClient.put<MLBackendResponse>(`/projects/${projectId}/ml-backends/${backendId}`, payload),

  delete: (projectId: string, backendId: string) =>
    apiClient.delete(`/projects/${projectId}/ml-backends/${backendId}`),

  health: (projectId: string, backendId: string) =>
    apiClient.post<{ status: string; backend_id: string; backend_name: string }>(
      `/projects/${projectId}/ml-backends/${backendId}/health`,
    ),

  unload: (projectId: string, backendId: string) =>
    apiClient.post<{ ok: boolean; unloaded: boolean; loaded: boolean }>(
      `/projects/${projectId}/ml-backends/${backendId}/unload`,
    ),

  // v0.10.26 · 可选 variant body 预热指定变体 (模型市场单变体预热); 缺省回退默认变体.
  // v0.10.36 · 可选 taskType ("image" | "video"): "video" 预热独立 video tracker 池 (仅认 sam_variant, 无 dino).
  reload: (
    projectId: string,
    backendId: string,
    variant?: MLBackendVariant,
    taskType?: "image" | "video",
  ) =>
    apiClient.post<{
      ok: boolean;
      loaded: boolean;
      reloaded: boolean;
      sam_variant?: string;
      dino_variant?: string;
      task_type?: "image" | "video";
    }>(
      `/projects/${projectId}/ml-backends/${backendId}/reload`,
      variant || taskType
        ? { ...(variant ?? {}), ...(taskType ? { task_type: taskType } : {}) }
        : undefined,
    ),

  predictTest: (projectId: string, backendId: string, taskId: string) =>
    apiClient.post(`/projects/${projectId}/ml-backends/${backendId}/predict-test?task_id=${taskId}`),

  interactiveAnnotate: (projectId: string, backendId: string, payload: InteractiveRequest) =>
    apiClient.post<{
      result: unknown[];
      score: number | null;
      inference_time_ms: number | null;
      cache_hit?: boolean | null;
      model_load_ms?: number | null;
    }>(
      `/projects/${projectId}/ml-backends/${backendId}/interactive-annotating`,
      payload,
    ),

  // v0.14.14 协议 §4.4 · POST /warmup 代理. body 各 backend 自定义:
  //   yolo:  { task: "detection", variants: { series: "yolo11", size: "s" } }
  //   gsam2: { variants: { sam_variant: "small", dino_variant: "B" } }
  //   sam3:  {} 或 { variants: { model_variant: "sam3.1" } }
  warmup: (
    projectId: string,
    backendId: string,
    body?: Record<string, unknown>,
  ) =>
    apiClient.post<{
      ok: boolean;
      model_load_ms: number | null;
      cache_hit: boolean;
      evicted: string | null;
    }>(`/projects/${projectId}/ml-backends/${backendId}/warmup`, body ?? {}),
};
