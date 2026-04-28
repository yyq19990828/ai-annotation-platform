import { apiClient } from "./client";

export interface UploadInitPayload {
  project_id: string;
  file_name: string;
  content_type?: string;
}

export const filesApi = {
  initUpload: (payload: UploadInitPayload) =>
    apiClient.post<{ task_id: string; upload_url: string; expires_in: number }>(
      "/files/upload-init",
      payload,
    ),

  completeUpload: (taskId: string) =>
    apiClient.post<{ status: string; task_id: string }>(`/files/upload-complete/${taskId}`),

  getFileUrl: (taskId: string) =>
    apiClient.get<{ url: string; expires_in: number }>(`/files/tasks/${taskId}/file-url`),
};
