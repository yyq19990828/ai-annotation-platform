import { apiClient } from "./client";
import type { MLBackendSupportedVariantGroup } from "./ml-backends";

export interface BucketSummary {
  name: string;
  status: "ok" | "error";
  object_count: number;
  total_size_bytes: number;
  error: string | null;
  role: "annotations" | "datasets" | "bug-reports" | "media-cache" | "audit-archive";
}

export interface StorageOverview {
  items: BucketSummary[];
  total_object_count: number;
  total_size_bytes: number;
}

// v0.10.26 · 单变体 cache 桶 (来自 backend /cache/stats，key="sam/dino")。
export interface CacheBucketStat {
  size?: number;
  hits?: number;
  misses?: number;
  hit_rate?: number;
}

// v0.14.14 · 协议 §4.3 PoolStatus.loaded_keys 元数据 (loaded_at/last_used_at 为 ISO).
export interface PoolLoadedKey {
  key: string;
  loaded_at?: string;
  last_used_at?: string;
  hit_count?: number;
}

// v0.14.14 · 协议 §4.3 last_evict.
export interface PoolEvictRecord {
  key: string;
  at: string;
  reason: string;
}

// v0.10.26 · ModelPool 健康快照 (来自 backend /health.pool).
// v0.14.14 起 backend 改发 PoolStatus 字段 (cap/current_size/loaded_keys/last_evict);
// 老字段 loaded_variants/evict_count/per_variant_lru_ts 在 gsam2 双发期内并存,
// 消费方优先读新字段, 老字段仅作 fallback (本仓库 backend 升级到 v0.14.14 后可清).
export interface BackendPoolMeta {
  cap?: number;
  current_size?: number;
  loaded_keys?: PoolLoadedKey[];
  last_evict?: PoolEvictRecord | null;
  // 下三个字段是 v0.14.14 协议前的老字段, gsam2 双发期内并存; 消费方应优先读
  // loaded_keys / last_evict, 这里保留仅为 fallback. 注: 不用 jsdoc @deprecated tag,
  // 避免触发 TS6385/6387 在 fallback 调用点污染警告 (sessionVariantCache 同款理由).
  loaded_variants?: Array<{ sam_variant: string; dino_variant: string }>;
  evict_count?: number;
  per_variant_lru_ts?: Record<string, number>;
}

// v0.10.36 · video tracker 独立显存池快照 (来自 backend /health.video_pool).
// v0.14.14 起同样上报 PoolStatus loaded_keys; video pool 的 key 就是 sam_variant 字符串.
export interface VideoPoolMeta {
  cap: number;
  current_size?: number;
  loaded_keys?: PoolLoadedKey[];
  last_evict?: PoolEvictRecord | null;
  // 老字段, 同 BackendPoolMeta.loaded_variants 说明; 优先读 loaded_keys.
  loaded_variants: string[];
  active_sessions: number;
  idle_seconds?: number;
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
    buckets?: Record<string, CacheBucketStat>;
    [key: string]: unknown;
  } | null;
  model_version?: string | null;
  /** v0.10.26 · ModelPool 多变体并存快照 (grounded-sam2 才有)。 */
  pool?: BackendPoolMeta | null;
  /** v0.10.36 · video tracker 独立显存池快照 (支持视频追踪的 backend 才有)。 */
  video_pool?: VideoPoolMeta | null;
  /** v0.10.37 · /setup 能力快照 (epic 阶段 1); check_health 探 /setup 后落库。 */
  capabilities?: BackendCapabilities | null;
}

// v0.10.37 · backend /setup 能力快照 (epic 阶段 1); modalities 为派生视图 (image/video)。
export interface BackendCapabilities {
  is_interactive: boolean;
  supported_prompts: string[];
  supported_trackers: string[];
  supported_text_outputs: string[];
  supported_geometric_outputs: string[];
  modalities: string[];
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

// v0.9.7 · /all 全局 backend 列表 (Wizard step 4 复用 backend 配置).
export interface GlobalBackendItem {
  id: string;
  name: string;
  url: string;
  state: string;
  is_interactive: boolean;
  auth_method: string;
  health_meta: BackendHealthMeta | null;
  source_project_id: string;
  source_project_name: string;
  last_checked_at: string | null;
}

export interface GlobalBackendListResponse {
  items: GlobalBackendItem[];
}

// ── v0.10.26 · 容器直连观测 (与项目注册解耦) ─────────────────────────
export interface VariantCatalog {
  sam_variant: string[];
  dino_variant: string[];
}

export interface ObserveTarget {
  url: string;
  ok: boolean;
  latency_ms: number;
  status_code?: number | null;
  error?: string | null;
  gpu_info?: { memory_used_mb?: number; memory_total_mb?: number } | null;
  model_version?: string | null;
  pool?: BackendPoolMeta | null;
  /** v0.10.36 · video tracker 独立显存池观测。 */
  video_pool?: VideoPoolMeta | null;
  /** v0.10.36 · 支持的视频 tracker 列表 (如 ["sam2_video"]); 空 = 不支持视频追踪。 */
  supported_trackers?: string[];
  cache?: { hit_rate?: number; buckets?: Record<string, CacheBucketStat> } | null;
  variant_catalog?: VariantCatalog | null;
  supported_variants?: MLBackendSupportedVariantGroup[];
  supports_variants: boolean;
  registered: boolean;
  registered_label?: string | null;
}

export interface ObserveResponse {
  targets: ObserveTarget[];
  configured_count: number;
}

export interface SmokeTestRequest {
  url: string;
  sam_variant?: string;
  dino_variant?: string;
  variant?: Record<string, string>;
}

export interface SmokeTestResponse {
  ok: boolean;
  skipped: boolean;
  reloaded?: boolean | null;
  auto_unloaded: boolean;
  load_latency_ms?: number | null;
  loaded_variant?: { sam_variant?: string; dino_variant?: string } | null;
  message: string;
  error?: string | null;
}

export const adminMlIntegrationsApi = {
  overview: () =>
    apiClient.get<MLIntegrationsOverview>("/admin/ml-integrations/overview"),
  probe: (payload: ProbeRequest) =>
    apiClient.post<ProbeResponse>("/admin/ml-integrations/probe", payload),
  runtimeHints: () =>
    apiClient.get<RuntimeHints>("/admin/ml-integrations/runtime-hints"),
  /** v0.9.7 · 全局 backend 去重列表, 用于 Wizard step 4 dropdown. */
  listAll: () =>
    apiClient.get<GlobalBackendListResponse>("/admin/ml-integrations/all"),
  /** v0.10.26 · 直连观测 env 配的后端容器 (健康/变体目录/registered 标记). */
  observe: () => apiClient.get<ObserveResponse>("/admin/ml-integrations/observe"),
  /** v0.10.26 · 试启动: 空池时 warm→自动 unload 验证可加载性. */
  observeSmokeTest: (payload: SmokeTestRequest) =>
    apiClient.post<SmokeTestResponse>("/admin/ml-integrations/observe/smoke-test", payload),
};
