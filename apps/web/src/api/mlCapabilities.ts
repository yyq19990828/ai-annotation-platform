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
export interface CapabilityInstanceModel {
  id: string;
  display_name: string;
  task: string;
  infra: string | null;
  is_interactive: boolean;
  supported_prompts: string[];
  supported_geometric_outputs: string[];
  supported_trackers: string[];
  modality: string | null;
}

export interface CapabilityInstance {
  source: "env_only" | "registered" | string;
  name: string;
  infra: string;
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
