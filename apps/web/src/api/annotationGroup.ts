/**
 * I12 · Object Group + 批量编辑 API client.
 *
 * 端点设计见 docs/plans/archive/2026-05-19-v0.10.19-i4-i12-i18-workbench-detail-extensions.md.
 * 所有端点要求 ids 属于同一 task (router 层强约束).
 */
import { apiClient } from "./client";

export interface AnnotationBulkPatch {
  class_name?: string;
  attributes?: Record<string, unknown>;
  z_order?: number;
  is_locked?: boolean;
  is_hidden?: boolean;
  /** 显式赋 group_id (数值); 不传保持原值. */
  group_id?: number;
  /** 显式清空 group_id (置 null); 与上面 group_id 互斥. */
  group_id_explicit_clear?: boolean;
}

export interface BulkUpdateRequest {
  ids: string[];
  patch: AnnotationBulkPatch;
}

export interface BulkUpdateResponse {
  updated_ids: string[];
  updated_count: number;
}

export interface GroupRequest {
  ids: string[];
  task_id: string;
}

export interface GroupResponse {
  group_id: number;
  affected_ids: string[];
}

export interface UngroupRequest {
  ids: string[];
}

export interface UngroupResponse {
  cleared_ids: string[];
  auto_cleared_orphans: string[];
}

export const annotationGroupApi = {
  bulkUpdate: (payload: BulkUpdateRequest) =>
    apiClient.post<BulkUpdateResponse>("/annotations/bulk-update", payload),

  group: (payload: GroupRequest) =>
    apiClient.post<GroupResponse>("/annotations/group", payload),

  ungroup: (payload: UngroupRequest) =>
    apiClient.post<UngroupResponse>("/annotations/ungroup", payload),
};
