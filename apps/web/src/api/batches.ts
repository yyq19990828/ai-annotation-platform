import { apiClient } from "./client";
import type { ExportFormat } from "./projects";
import type { UserBrief } from "@/types";

export interface BatchResponse {
  id: string;
  project_id: string;
  dataset_id: string | null;
  display_id: string;
  name: string;
  description: string;
  status: string;
  priority: number;
  deadline: string | null;
  /** v0.7.2 派生字段（= [annotator_id, reviewer_id] filter null）；保留为兼容旧路径，新代码优先用 annotator/reviewer。 */
  assigned_user_ids: string[];
  /** v0.7.2 · 单值分派 */
  annotator_id: string | null;
  reviewer_id: string | null;
  /** 责任人 brief（avatar / name / role） */
  annotator: UserBrief | null;
  reviewer: UserBrief | null;
  total_tasks: number;
  completed_tasks: number;
  review_tasks: number;
  approved_tasks: number;
  rejected_tasks: number;
  progress_pct: number;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  review_feedback: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface BatchCreatePayload {
  name: string;
  description?: string;
  dataset_id?: string;
  priority?: number;
  deadline?: string;
  annotator_id?: string | null;
  reviewer_id?: string | null;
}

export interface BatchUpdatePayload {
  name?: string;
  description?: string;
  priority?: number;
  deadline?: string;
  annotator_id?: string | null;
  reviewer_id?: string | null;
}

export interface BatchSplitPayload {
  strategy: "metadata" | "id_range" | "random";
  metadata_key?: string;
  metadata_value?: string;
  item_ids?: string[];
  n_batches?: number;
  name_prefix?: string;
  priority?: number;
  deadline?: string;
  annotator_id?: string | null;
  reviewer_id?: string | null;
}

export interface ProjectDistributeBatchesPayload {
  annotator_ids?: string[];
  reviewer_ids?: string[];
  only_unassigned?: boolean;
}

export interface BatchDistributeResultResponse {
  distributed_batches: number;
  annotator_per_batch: Record<string, string | null>;
  reviewer_per_batch: Record<string, string | null>;
}

// v0.7.3 · 多选批量操作
export interface BulkBatchActionItem {
  batch_id: string;
  reason: string;
}

export interface BulkBatchActionResponse {
  succeeded: string[];
  skipped: BulkBatchActionItem[];
  failed: BulkBatchActionItem[];
}

export interface BulkBatchReassignPayload {
  batch_ids: string[];
  annotator_id?: string | null;
  reviewer_id?: string | null;
}

// v0.7.3 · 批次操作历史抽屉
export interface BatchAuditLogEntry {
  id: number;
  created_at: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
}

export const batchesApi = {
  list: (projectId: string, status?: string) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    const qs = q.toString();
    return apiClient.get<BatchResponse[]>(
      `/projects/${projectId}/batches${qs ? `?${qs}` : ""}`,
    );
  },

  get: (projectId: string, batchId: string) =>
    apiClient.get<BatchResponse>(`/projects/${projectId}/batches/${batchId}`),

  create: (projectId: string, payload: BatchCreatePayload) =>
    apiClient.post<BatchResponse>(`/projects/${projectId}/batches`, payload),

  update: (projectId: string, batchId: string, payload: BatchUpdatePayload) =>
    apiClient.patch<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}`,
      payload,
    ),

  remove: (projectId: string, batchId: string) =>
    apiClient.delete<void>(`/projects/${projectId}/batches/${batchId}`),

  transition: (
    projectId: string,
    batchId: string,
    targetStatus: string,
    reason?: string,
  ) =>
    apiClient.post<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}/transition`,
      reason ? { target_status: targetStatus, reason } : { target_status: targetStatus },
    ),

  split: (projectId: string, payload: BatchSplitPayload) =>
    apiClient.post<BatchResponse[]>(
      `/projects/${projectId}/batches/split`,
      payload,
    ),

  reject: (projectId: string, batchId: string, feedback: string) =>
    apiClient.post<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}/reject`,
      { feedback },
    ),

  // v0.7.6 · 终极重置：任意状态 → draft（owner-only，reason ≥ 10 字）
  reset: (projectId: string, batchId: string, reason: string) =>
    apiClient.post<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}/reset`,
      { reason },
    ),

  distributeBatches: (
    projectId: string,
    payload: ProjectDistributeBatchesPayload,
  ) =>
    apiClient.post<BatchDistributeResultResponse>(
      `/projects/${projectId}/batches/distribute-batches`,
      payload,
    ),

  // v0.7.3 · 批量操作
  bulkArchive: (projectId: string, batchIds: string[]) =>
    apiClient.post<BulkBatchActionResponse>(
      `/projects/${projectId}/batches/bulk-archive`,
      { batch_ids: batchIds },
    ),

  bulkDelete: (projectId: string, batchIds: string[]) =>
    apiClient.post<BulkBatchActionResponse>(
      `/projects/${projectId}/batches/bulk-delete`,
      { batch_ids: batchIds },
    ),

  bulkReassign: (projectId: string, payload: BulkBatchReassignPayload) =>
    apiClient.post<BulkBatchActionResponse>(
      `/projects/${projectId}/batches/bulk-reassign`,
      payload,
    ),

  bulkActivate: (projectId: string, batchIds: string[]) =>
    apiClient.post<BulkBatchActionResponse>(
      `/projects/${projectId}/batches/bulk-activate`,
      { batch_ids: batchIds },
    ),

  // v0.7.3 · 批次操作历史
  auditLogs: (projectId: string, batchId: string, limit = 50) =>
    apiClient.get<BatchAuditLogEntry[]>(
      `/projects/${projectId}/batches/${batchId}/audit-logs?limit=${limit}`,
    ),

  // v0.7.3 · 未归类任务计数（batch_id IS NULL）— 顶部横带提示用
  unclassifiedCount: (projectId: string) =>
    apiClient.get<{ count: number }>(
      `/projects/${projectId}/batches/unclassified-count`,
    ),

  exportBatch: async (projectId: string, batchId: string, format: ExportFormat) => {
    const resp = await fetch(
      `/api/v1/projects/${projectId}/batches/${batchId}/export?format=${format}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      },
    );
    if (!resp.ok) throw new Error("Export failed");
    const blob = await resp.blob();
    const cd = resp.headers.get("content-disposition") ?? "";
    const fname = cd.match(/filename=(.+)/)?.[1] ?? `batch_export.${format === "coco" ? "json" : "zip"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
  },
};
