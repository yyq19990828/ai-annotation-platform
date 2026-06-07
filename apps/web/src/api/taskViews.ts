import { apiClient } from "./client";
import type { TaskResponse } from "@/types";

export type TaskViewVisibility = "private" | "project";
export type TaskFilterOp = "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";

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

  queryView: (projectId: string, viewId: string, limit: number, offset: number) => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get<ProjectTaskQueryResponse>(
      `/projects/${projectId}/task-views/${viewId}/tasks?${q}`,
    );
  },
};
