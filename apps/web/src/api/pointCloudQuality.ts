import { apiClient } from "./client";

export type PointCloudQualitySeverity = "blocker" | "warning" | "info";
export type PointCloudQualityStatus = "open" | "resolved" | "wont_fix" | "stale";
export type PointCloudQualityReviewVerdict =
  | "confirmed"
  | "false_positive"
  | "accepted_exception"
  | "uncertain";

export interface PointCloudQualityThresholdConfig {
  minimum_points: number;
  ground_sample_min: number;
  ground_margin_m: number;
  ground_penetration_m: number;
  ground_float_m: number;
  size_min_samples: number;
  size_mad_z: number;
  temporal_center_jump_m: number;
  temporal_size_change_ratio: number;
  temporal_yaw_jump_rad: number;
}

export type PointCloudQualityThresholdOverride = Partial<PointCloudQualityThresholdConfig>;

export interface PointCloudQualityConfig {
  schema_version: 2;
  config_revision: number;
  enabled: boolean;
  thresholds: PointCloudQualityThresholdConfig;
  enabled_rules: string[];
  severity_overrides: Record<string, "info" | "warning" | "blocker" | "off">;
  class_thresholds: Record<string, PointCloudQualityThresholdOverride>;
  governance: {
    minimum_reviewed_per_rule: number;
    maximum_false_positive_rate: number;
    minimum_confirmed_retention: number;
  };
}

export interface PointCloudQualityLocator {
  scene_id: string;
  frame_index: number | null;
  task_id: string | null;
  annotation_id: string | null;
  scene_track_id: string | null;
  camera: string | null;
  auxiliary_layers: string[];
}

export interface PointCloudQualityIssue {
  id: string;
  run_id: string | null;
  last_seen_run_id: string | null;
  project_id: string;
  scene_id: string;
  task_id: string | null;
  annotation_id: string | null;
  annotation_version: number | null;
  scene_track_id: string | null;
  track_revision: number | null;
  related_annotation_ids: string[];
  source_versions: Record<string, number>;
  class_name: string | null;
  code: string;
  rule_version: number;
  severity: PointCloudQualitySeverity;
  status: PointCloudQualityStatus;
  frame_start: number | null;
  frame_end: number | null;
  metric: Record<string, unknown>;
  threshold: Record<string, unknown>;
  evidence: Record<string, unknown>;
  locator: PointCloudQualityLocator;
  suggested_command: string | null;
  resolution_reason: string | null;
  resolved_by_id: string | null;
  resolved_at: string | null;
  review_verdict: PointCloudQualityReviewVerdict | null;
  review_note: string | null;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PointCloudQualityIssuePage {
  items: PointCloudQualityIssue[];
  total: number;
}

export interface PointCloudQualityRun {
  id: string;
  project_id: string;
  async_job_id: string | null;
  status: string;
  progress_pct: number;
  scope_json: Record<string, unknown>;
  config_revision: number;
  config_digest: string;
  source_snapshot_digest: string;
  summary: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  reused: boolean;
}

export type PointCloudQualityRunScope =
  | { scope: "scene_ids"; scene_ids: string[] }
  | { scope: "task_ids"; task_ids: string[] };

export interface PointCloudQualityEvaluation {
  id: string;
  project_id: string;
  created_by_id: string | null;
  baseline_config_revision: number;
  baseline_config_digest: string;
  baseline_config_snapshot?: PointCloudQualityConfig;
  candidate_config_digest: string;
  candidate_config_snapshot?: PointCloudQualityConfig;
  cutoff_at: string;
  sample_count: number;
  summary: {
    sample_count?: number;
    metric_contract?: Record<string, string>;
    changed_targets?: Array<{
      code: string;
      class_name: string | null;
      status: "insufficient_data" | "hold" | "promote";
      reasons: string[];
      baseline: PointCloudQualityMetricSummary;
      candidate: PointCloudQualityMetricSummary;
    }>;
    [key: string]: unknown;
  };
  gate_status: "insufficient_data" | "hold" | "promote";
  gate_reasons: Array<Record<string, unknown>>;
  promoted_by_id: string | null;
  promoted_at: string | null;
  promoted_config_revision: number | null;
  created_at: string;
}

export interface PointCloudQualityMetricSummary {
  sample_count: number;
  triggered_count: number;
  confirmed: number;
  false_positive: number;
  accepted_exception: number;
  uncertain: number;
  decidable_count: number;
  observed_precision: number | null;
  observed_false_positive_rate: number | null;
  confirmed_retention: number | null;
}

export interface PointCloudQualityEvaluationPage {
  items: PointCloudQualityEvaluation[];
  total: number;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export const pointCloudQualityApi = {
  issues: (
    projectId: string,
    params: {
      sceneId?: string;
      taskId?: string;
      status?: PointCloudQualityStatus;
      severity?: PointCloudQualitySeverity;
      code?: string;
      frame?: number;
      limit?: number;
    },
    signal?: AbortSignal,
  ) =>
    apiClient.get<PointCloudQualityIssuePage>(
      `/projects/${projectId}/point-cloud-quality/issues${queryString({
        scene_id: params.sceneId,
        task_id: params.taskId,
        status: params.status,
        severity: params.severity,
        code: params.code,
        frame: params.frame,
        limit: params.limit ?? 200,
      })}`,
      { signal },
    ),
  runScope: (projectId: string, scope: PointCloudQualityRunScope) =>
    apiClient.post<PointCloudQualityRun>(`/projects/${projectId}/point-cloud-quality/runs`, scope),
  run: (projectId: string, runId: string, signal?: AbortSignal) =>
    apiClient.get<PointCloudQualityRun>(
      `/projects/${projectId}/point-cloud-quality/runs/${runId}`,
      { signal },
    ),
  patchIssue: (
    issueId: string,
    value: {
      status: "open" | "resolved" | "wont_fix";
      reason?: string;
      review_verdict?: PointCloudQualityReviewVerdict;
      review_note?: string;
    },
  ) =>
    apiClient.patch<PointCloudQualityIssue>(`/point-cloud-quality/issues/${issueId}`, {
      ...value,
    }),
  evaluations: (projectId: string, signal?: AbortSignal) =>
    apiClient.get<PointCloudQualityEvaluationPage>(
      `/projects/${projectId}/point-cloud-quality/evaluations?limit=20`,
      { signal },
    ),
  createEvaluation: (projectId: string, candidateConfig: PointCloudQualityConfig) =>
    apiClient.post<PointCloudQualityEvaluation>(
      `/projects/${projectId}/point-cloud-quality/evaluations`,
      { candidate_config: candidateConfig },
    ),
  promoteEvaluation: (projectId: string, evaluationId: string) =>
    apiClient.post<PointCloudQualityEvaluation>(
      `/projects/${projectId}/point-cloud-quality/evaluations/${evaluationId}/promote`,
      {},
    ),
};
