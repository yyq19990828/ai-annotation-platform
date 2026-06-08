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

export const mlCapabilitiesApi = {
  getProtocol: () =>
    apiClient.get<ProtocolCapabilities>("/ml-capabilities/protocol"),
};

export function useProtocolCapabilities() {
  return useQuery({
    queryKey: ["ml-capabilities", "protocol"],
    queryFn: () => mlCapabilitiesApi.getProtocol(),
    staleTime: 5 * 60_000, // SSOT 是协议常量, 5 分钟缓存足够。
    gcTime: 30 * 60_000,
  });
}
