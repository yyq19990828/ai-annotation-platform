import type { CocoRle } from "@/pages/Workbench/stage/shared/geometry/maskRle";
import { apiClient } from "./client";

export type MaskQcSeverity = "info" | "warning" | "blocker";
export type MaskQcIssueStatus = "open" | "resolved" | "wont_fix" | "stale";
export type MaskCompareBaseline =
  | "previous_version"
  | "tracker_candidate"
  | "ai_candidate"
  | "neighbor_keyframe";

export interface MaskQcRegionBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MaskQcIssue {
  id: string;
  run_id: string | null;
  last_seen_run_id: string | null;
  project_id: string;
  task_id: string;
  annotation_id: string;
  annotation_version: number;
  related_annotation_ids: string[];
  source_versions: Record<string, number>;
  code: string;
  severity: MaskQcSeverity;
  status: Exclude<MaskQcIssueStatus, "stale">;
  effective_status: MaskQcIssueStatus;
  frame_start: number | null;
  frame_end: number | null;
  metric: Record<string, unknown>;
  threshold: Record<string, unknown>;
  region_bbox: MaskQcRegionBBox | null;
  region_mask_ref: Record<string, unknown> | null;
  region_digest: string | null;
  source: Record<string, unknown>;
  suggestion: string | null;
  resolved_by_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaskQcIssuePage {
  items: MaskQcIssue[];
  next_cursor: string | null;
}

export interface TaskMaskQcSummary {
  task_id: string;
  run_id: string | null;
  qc_digest: string | null;
  source_snapshot_digest: string | null;
  status: "not_applicable" | "pending" | "running" | "completed" | "failed" | "cancelled" | "stale";
  progress_pct: number;
  counts: Record<string, number>;
  blocking: boolean;
}

export interface MaskQcRun {
  id: string;
  project_id: string;
  async_job_id: string | null;
  status: string;
  progress_pct: number;
  config_revision: number;
  config_digest: string;
  source_snapshot_digest: string;
  source_versions: Record<string, number>;
  summary: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
  reused: boolean;
}

export interface MaskCompareSide {
  annotation_id: string;
  annotation_version: number;
  frame_index: number | null;
  source: string;
  state: string | null;
  digest: string;
  size: [number, number];
  content_path: string;
  candidate_job_id: string | null;
  candidate_digest: string | null;
  candidate_instance_id: string | null;
}

export interface MaskCompareResult {
  baseline_kind: MaskCompareBaseline;
  current: MaskCompareSide;
  baseline: MaskCompareSide;
  metrics: MaskCompareMetrics;
  loss: string[];
}

export interface MaskCompareMetrics {
    current_area_pixels: number;
    baseline_area_pixels: number;
    intersection_pixels: number;
    union_pixels: number;
    changed_pixels: number;
    added_pixels: number;
    removed_pixels: number;
    iou_numerator: number;
    iou_denominator: number;
    dice_numerator: number;
    dice_denominator: number;
}

function queryString(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export const maskQcApi = {
  issues: (projectId: string, params: {
    taskId?: string;
    status?: MaskQcIssueStatus;
    severity?: MaskQcSeverity;
    code?: string;
    limit?: number;
    cursor?: string;
  }, signal?: AbortSignal) => apiClient.get<MaskQcIssuePage>(
    `/projects/${projectId}/mask-qc/issues${queryString({
      task_id: params.taskId,
      status: params.status,
      severity: params.severity,
      code: params.code,
      limit: params.limit ?? 100,
      cursor: params.cursor,
    })}`,
    { signal },
  ),
  summary: (taskId: string, signal?: AbortSignal) =>
    apiClient.get<TaskMaskQcSummary>(`/tasks/${taskId}/mask-qc/summary`, { signal }),
  runTask: (projectId: string, taskId: string) => apiClient.post<MaskQcRun>(
    `/projects/${projectId}/mask-qc/runs`,
    { scope: "task_ids", task_ids: [taskId], annotation_ids: [], expected_versions: {} },
  ),
  patchIssue: (issueId: string, status: "open" | "resolved" | "wont_fix") =>
    apiClient.patch<MaskQcIssue>(`/mask-qc/issues/${issueId}`, { status }),
  compare: (params: {
    annotationId: string;
    annotationVersion: number;
    baseline: MaskCompareBaseline;
    frameIndex?: number | null;
    candidateJobId?: string | null;
    candidateJobRevision?: number | null;
    candidateDigest?: string | null;
    candidateInstanceId?: string | null;
  }, signal?: AbortSignal) => apiClient.get<MaskCompareResult>(
    `/annotations/${params.annotationId}/mask-compare${queryString({
      annotation_version: params.annotationVersion,
      baseline: params.baseline,
      frame_index: params.frameIndex,
      candidate_job_id: params.candidateJobId,
      candidate_job_revision: params.candidateJobRevision,
      candidate_digest: params.candidateDigest,
      candidate_instance_id: params.candidateInstanceId,
    })}`,
    { signal },
  ),
  content: (contentPath: string, signal?: AbortSignal) =>
    apiClient.get<CocoRle>(contentPath, { signal }),
  issueRegion: (issueId: string, digest: string, signal?: AbortSignal) =>
    apiClient.get<CocoRle>(
      `/mask-qc/issues/${issueId}/region-content${queryString({ digest })}`,
      { signal },
    ),
  versionContent: (params: {
    annotationId: string;
    annotationVersion: number;
    digest: string;
    frameIndex: number | null;
  }, signal?: AbortSignal) =>
    apiClient.get<CocoRle>(
      `/annotations/${params.annotationId}/mask-compare/content${queryString({
        annotation_version: params.annotationVersion,
        digest: params.digest,
        frame_index: params.frameIndex,
      })}`,
      { signal },
    ),
};
