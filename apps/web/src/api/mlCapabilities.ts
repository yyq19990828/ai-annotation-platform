// v0.14.11 · 协议级能力目录 API (与 ml backend 注册解耦).
// 后端 SSOT: apps/api/app/services/capability_registry.py.
// 端点: GET /v1/ml-capabilities/protocol — 返回 task / infra / modality / geometry
// 四张受控词表 + 每条 task 的人类可读元数据。

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface SuggestedBackend {
  name: string;
  repo_url: string;
  summary: string;
  research_link: string | null;
  infra: string | null;
  builtin: boolean;
}

export interface ProtocolTask {
  id: string;
  label: string;
  summary: string;
  default_geometry: string[];
  default_modalities: string[];
  typical_models: string[];
  protocol_notes: string;
  suggested_backends: SuggestedBackend[];
}

export interface ProtocolInfra {
  id: string;
  label: string;
  summary: string;
}

export interface ProtocolModality {
  id: string;
  label: string;
  summary: string;
}

export interface ProtocolGeometry {
  id: string;
  label: string;
  summary: string;
}

export interface ProtocolCapabilities {
  version: string;
  tasks: ProtocolTask[];
  infras: ProtocolInfra[];
  modalities: ProtocolModality[];
  geometries: ProtocolGeometry[];
}

// v0.14.11 · 平台已知 backend 实例 (env-only + 项目级注册合并, 与注册解耦)。
// v0.14.12 起 supported_variants + variant_combinations 透传, 让前端模型市场列表
// 能按 axis 拆「具体模型」行 (yolo 的 series×size 受 MODEL_MATRIX 约束)。
export interface InstanceVariantOption {
  value: string;
  label?: string;
  vram_gb?: number;
  tier?: string;
  recommended?: boolean;
  note?: string;
}

export interface InstanceVariantGroup {
  key: string;
  title?: string;
  description?: string;
  variants?: InstanceVariantOption[];
}

export interface CapabilityInstanceModel {
  id: string;
  display_name: string;
  task: string;
  model_family?: string | null;
  // 能力可见性: internal=目录可见但不对外选用; public/缺省=对外开放.
  visibility?: "internal" | "public";
  infra: string | null;
  is_interactive: boolean;
  supported_prompts: string[];
  supported_geometric_outputs: string[];
  supported_trackers: string[];
  modality: string | null;
  supported_variants?: InstanceVariantGroup[];
  variant_combinations?: string[][];
  // v0.14.12 · 跨 task 共享物理权重 (gsam2 SAM2 一份权重服务 seg/iseg/tracker, 是 true;
  // yolo 每 task 独立权重, 是 false). 前端列表行单位据此切换:
  //   true  → 同 (axis_key, value) 跨 task 合并到一行;
  //   false → 每 task 独立一行, 行名加任务后缀 (YOLOv8-OBB / YOLOv8-Seg).
  variants_shared_across_tasks?: boolean;
  // v0.14.13 · backend 自报的默认 variant 组合 (dict[axis_key, value]).
  // 前端 VariantSelector 在用户未选时取此作初值; 优先级:
  // 项目级 project.default_variants[backend_id] > 本字段 > backend 启动 env 默认.
  default_variants?: Record<string, string>;
  // v0.18.0 · backend 自报的输出属性 schema (协议 §3.x). 二阶段 backend (如 onnxtools
  // 车辆属性) 通过此字段声明 /predict 会写入哪些 attributes (vehicle_type / color 等),
  // 含 select options. 前端「从 ML Backend 导入属性」据此一键导入项目 attribute_schema,
  // 免去手抄选项 + key 对齐。老 backend 缺字段 = 无属性输出。
  output_attribute_schema?: OutputAttributeSchemaItem[];
}

// v0.18.0 · backend 自报的单个输出属性字段 (与项目 AttributeField 同构子集).
export interface OutputAttributeSchemaItem {
  key: string;
  label: string;
  type: string; // text/number/boolean/select/multiselect/range
  options?: { value: string; label: string }[];
}

export interface CapabilityInstance {
  source: "env_only" | "registered" | string;
  name: string;
  infra: string;
  // v0.14.14 · backend 自报是否支持 POST /warmup (协议 §4.4); 老 backend 缺字段 = false.
  // 前端模型市场 "⚡ 预热" 按钮据此置灰.
  warmup_endpoint?: boolean;
  models: CapabilityInstanceModel[];
}

export interface CapabilityInstancesResponse {
  instances: CapabilityInstance[];
}

export const mlCapabilitiesApi = {
  getProtocol: () =>
    apiClient.get<ProtocolCapabilities>("/ml-capabilities/protocol"),
  getInstances: () =>
    apiClient.get<CapabilityInstancesResponse>("/ml-capabilities/instances"),
};

export function useProtocolCapabilities() {
  return useQuery({
    queryKey: ["ml-capabilities", "protocol"],
    queryFn: () => mlCapabilitiesApi.getProtocol(),
    staleTime: 5 * 60_000, // SSOT 是协议常量, 5 分钟缓存足够。
    gcTime: 30 * 60_000,
  });
}

export function useCapabilityInstances() {
  return useQuery({
    queryKey: ["ml-capabilities", "instances"],
    queryFn: () => mlCapabilitiesApi.getInstances(),
    staleTime: 30_000, // 实例层会跟 backend 上下线动态变化, 缓存短一些。
    refetchInterval: 60_000,
  });
}
