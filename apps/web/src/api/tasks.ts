import { apiClient } from "./client";

export interface TaskResponse {
  id: string;
  project_id: string;
  display_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  tags: string[];
  status: string;
  assignee_id: string | null;
  sequence_order: number | null;
  created_at: string;
}

export interface AnnotationResponse {
  id: string;
  task_id: string;
  user_id: string | null;
  source: "human" | "ai" | "ai-accepted";
  annotation_type: string;
  class_name: string;
  geometry: { x: number; y: number; w: number; h: number };
  confidence: number | null;
  is_active: boolean;
  created_at: string;
}

export interface AnnotationPayload {
  source: "human" | "ai" | "ai-accepted";
  annotation_type?: string;
  class_name: string;
  geometry: { x: number; y: number; w: number; h: number };
  confidence?: number;
}

export interface SubmitResponse {
  status: string;
  task_id: string;
}

export const tasksApi = {
  get: (id: string) => apiClient.get<TaskResponse>(`/tasks/${id}`),

  getAnnotations: (id: string) =>
    apiClient.get<AnnotationResponse[]>(`/tasks/${id}/annotations`),

  createAnnotation: (id: string, payload: AnnotationPayload) =>
    apiClient.post<AnnotationResponse>(`/tasks/${id}/annotations`, payload),

  submit: (id: string) =>
    apiClient.post<SubmitResponse>(`/tasks/${id}/submit`),
};
