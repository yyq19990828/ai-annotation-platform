import { apiClient } from "./client";

export interface AnnotationCommentResponse {
  id: string;
  annotation_id: string;
  project_id: string | null;
  author_id: string;
  author_name: string | null;
  body: string;
  is_resolved: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export const commentsApi = {
  listByAnnotation: (annotationId: string) =>
    apiClient.get<AnnotationCommentResponse[]>(`/annotations/${annotationId}/comments`),

  create: (annotationId: string, body: string) =>
    apiClient.post<AnnotationCommentResponse>(`/annotations/${annotationId}/comments`, { body }),

  patch: (id: string, payload: { body?: string; is_resolved?: boolean }) =>
    apiClient.patch<AnnotationCommentResponse>(`/comments/${id}`, payload),

  remove: (id: string) => apiClient.delete<void>(`/comments/${id}`),
};
