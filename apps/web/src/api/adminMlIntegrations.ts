import { apiClient } from "./client";

export interface BucketSummary {
  name: string;
  status: "ok" | "error";
  object_count: number;
  total_size_bytes: number;
  error: string | null;
  role: "annotations" | "datasets";
}

export interface StorageOverview {
  items: BucketSummary[];
  total_object_count: number;
  total_size_bytes: number;
}

export interface BackendHealthMeta {
  gpu_info?: {
    device_name?: string;
    memory_used_mb?: number;
    memory_total_mb?: number;
    memory_free_mb?: number;
  } | null;
  cache?: {
    hit_rate?: number;
    hits?: number;
    misses?: number;
    [key: string]: unknown;
  } | null;
  model_version?: string | null;
}

export interface MLBackendItem {
  id: string;
  project_id: string;
  name: string;
  url: string;
  state: string;
  is_interactive: boolean;
  auth_method: string;
  extra_params: Record<string, unknown>;
  /** v0.9.6 · backend `/health` 深度指标缓存 (gpu_info / cache / model_version). */
  health_meta?: BackendHealthMeta | null;
  error_message: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMLBackendsGroup {
  project_id: string;
  project_name: string;
  backends: MLBackendItem[];
}

export interface MLIntegrationsOverview {
  storage: StorageOverview;
  projects: ProjectMLBackendsGroup[];
  total_backends: number;
  connected_backends: number;
}

// ── v0.9.6 · /probe + /runtime-hints ─────────────────────────────────

export interface ProbeRequest {
  url: string;
  auth_method?: "none" | "token";
  auth_token?: string | null;
}

export interface ProbeResponse {
  ok: boolean;
  latency_ms: number;
  status_code?: number | null;
  error?: string | null;
  gpu_info?: Record<string, unknown> | null;
  cache?: Record<string, unknown> | null;
  model_version?: string | null;
}

export interface RuntimeHints {
  ml_backend_default_url: string | null;
}

export const adminMlIntegrationsApi = {
  overview: () =>
    apiClient.get<MLIntegrationsOverview>("/admin/ml-integrations/overview"),
  probe: (payload: ProbeRequest) =>
    apiClient.post<ProbeResponse>("/admin/ml-integrations/probe", payload),
  runtimeHints: () =>
    apiClient.get<RuntimeHints>("/admin/ml-integrations/runtime-hints"),
};
