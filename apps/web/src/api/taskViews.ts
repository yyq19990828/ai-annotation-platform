import { apiClient } from "./client";
import type { TaskResponse } from "@/types";

export type TaskViewVisibility = "private" | "project";
export type TaskFilterOp =
  | "eq"
  | "ne"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "missing"
  | "contains"
  | "between"
  | "contains_any"
  | "contains_all";

export interface TaskFilterRule {
  field: string;
  op: TaskFilterOp;
  value?: unknown;
}

export interface TaskFilterGroup {
  op: "and" | "or";
  rules: TaskFilterRule[];
}

export interface TaskSortItem {
  field: string;
  direction: "asc" | "desc";
}

export interface ProjectTaskView {
  id: string | null;
  key: string | null;
  project_id: string;
  owner_id: string | null;
  name: string;
  visibility: TaskViewVisibility;
  filter_json: Record<string, unknown>;
  sort_json: TaskSortItem[];
  columns_json: string[];
  builtin: boolean;
  task_count: number | null;
  created_at: string | null;
  updated_at: string | null;
  invalid_fields: string[];
}

export interface ProjectTaskViewPayload {
  name: string;
  visibility: TaskViewVisibility;
  filter_json: Record<string, unknown>;
  sort_json: TaskSortItem[];
  columns_json: string[];
}

export interface ProjectTaskViewUpdatePayload {
  name?: string;
  visibility?: TaskViewVisibility;
  filter_json?: Record<string, unknown>;
  sort_json?: TaskSortItem[];
  columns_json?: string[];
}

export interface DataManagerTask extends TaskResponse {
  annotation_count: number;
  prediction_count: number;
  avg_prediction_confidence: number | null;
  unresolved_feedback_count: number;
  model_versions: string[];
  scene_name: string | null;
  frame_index: number | null;
  last_activity_at: string | null;
  annotation_source_counts: Record<string, number>;
  track_count: number;
  pending_prediction_shape_count: number;
  pending_tracker_job_count: number;
  keyframe_count: number;
  outside_range_count: number;
  camera_count: number;
  calibration_issue_count: number;
  scene_total_frames: number | null;
}

export interface DataManagerOption {
  value: string;
  label: string;
}

export interface DataManagerFilterField {
  key: string;
  label: string;
  group: string;
  value_type: "text" | "number" | "boolean" | "select" | "multiselect" | "datetime";
  operators: TaskFilterOp[];
  options: DataManagerOption[];
  expensive: boolean;
  tool_unit_id: string | null;
  attribute_key: string | null;
}

export interface DataManagerColumn {
  key: string;
  label: string;
  group: string;
  default: boolean;
  expensive: boolean;
}

export interface DataManagerSchema {
  project_kind: { data_type: string; type_key: string; scene_mode: boolean };
  tool_units: Array<{ id: string; classes: string[] }>;
  filter_fields: DataManagerFilterField[];
  columns: DataManagerColumn[];
  default_columns: string[];
  sort_fields: DataManagerOption[];
  metrics: Array<{ key: string; label: string; group: string }>;
  builtin_views: string[];
}

export interface DataManagerSummary {
  scope: { visible_task_total: number; matched_task_total: number };
  task_status: Record<string, number>;
  annotations: {
    total: number;
    single_frame: number;
    tracked: number;
    distinct_tracks: number;
    imported: number;
    by_source: Record<string, number>;
    by_class: Record<string, number>;
    by_tool_unit: Record<string, number>;
    by_type: Record<string, number>;
  };
  ai_review: { prediction_shapes: number; tracker_jobs: number };
  unresolved_feedback: number;
  attributes: Array<{
    tool_unit_id: string;
    key: string;
    label: string;
    eligible: number;
    present: number;
    missing: number;
    values: Record<string, number>;
  }>;
  kind_metrics: Record<string, number | null>;
}

export interface DataManagerMatchItem {
  entity_kind: "annotation" | "prediction_shape" | "tracker_job";
  id: string;
  shape_index: number | null;
  track_id: string | null;
  class_name: string | null;
  tool_unit_id: string | null;
  annotation_type: string | null;
  source: string | null;
  attributes: Record<string, unknown>;
  frame_index: number | null;
}

export interface DataManagerMatchesResponse {
  task_id: string;
  items: DataManagerMatchItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProjectTaskQueryPayload {
  filter_json: Record<string, unknown>;
  sort_json: TaskSortItem[];
  columns_json: string[];
  limit: number;
  offset: number;
}

export interface ProjectTaskQueryResponse {
  items: DataManagerTask[];
  total: number;
  limit: number;
  offset: number;
}

export const taskViewsApi = {
  list: (projectId: string) =>
    apiClient.get<{ items: ProjectTaskView[] }>(`/projects/${projectId}/task-views`),

  create: (projectId: string, payload: ProjectTaskViewPayload) =>
    apiClient.post<ProjectTaskView>(`/projects/${projectId}/task-views`, payload),

  update: (projectId: string, viewId: string, payload: ProjectTaskViewUpdatePayload) =>
    apiClient.patch<ProjectTaskView>(`/projects/${projectId}/task-views/${viewId}`, payload),

  remove: (projectId: string, viewId: string) =>
    apiClient.delete<void>(`/projects/${projectId}/task-views/${viewId}`),

  copy: (projectId: string, viewId: string, payload: { name?: string; visibility?: TaskViewVisibility }) =>
    apiClient.post<ProjectTaskView>(`/projects/${projectId}/task-views/${viewId}/copy`, payload),

  query: (projectId: string, payload: ProjectTaskQueryPayload) =>
    apiClient.post<ProjectTaskQueryResponse>(`/projects/${projectId}/tasks/query`, payload),

  schema: (projectId: string) =>
    apiClient.get<DataManagerSchema>(`/projects/${projectId}/data-manager/schema`),

  summary: (projectId: string, filterJson: Record<string, unknown>) =>
    apiClient.post<DataManagerSummary>(`/projects/${projectId}/data-manager/summary`, {
      filter_json: filterJson,
    }),

  matches: (projectId: string, taskId: string, filterJson: Record<string, unknown>) =>
    apiClient.post<DataManagerMatchesResponse>(
      `/projects/${projectId}/tasks/${taskId}/data-manager/matches`,
      { filter_json: filterJson, limit: 100, offset: 0 },
    ),

  queryView: (projectId: string, viewId: string, limit: number, offset: number) => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get<ProjectTaskQueryResponse>(
      `/projects/${projectId}/task-views/${viewId}/tasks?${q}`,
    );
  },
};
