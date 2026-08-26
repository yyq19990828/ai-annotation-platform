import { apiClient } from "./client";

export type PointCloudQualitySeverity = "blocker" | "warning" | "info";
export type PointCloudQualityStatus = "open" | "resolved" | "wont_fix" | "stale";

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
  patchIssue: (issueId: string, status: "open" | "resolved" | "wont_fix", reason?: string) =>
    apiClient.patch<PointCloudQualityIssue>(`/point-cloud-quality/issues/${issueId}`, {
      status,
      reason,
    }),
};
