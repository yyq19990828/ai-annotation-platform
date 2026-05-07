/**
 * v0.8.6 F6 · 失败预测管理 API。
 */
import { apiClient } from "./client";

export interface FailedPredictionItem {
  id: string;
  task_id: string | null;
  task_display_id: string | null;
  project_id: string;
  project_name: string | null;
  ml_backend_id: string | null;
  backend_name: string | null;
  model_version: string | null;
  error_type: string;
  message: string;
  retry_count: number;
  last_retry_at: string | null;
  created_at: string;
}

export interface FailedPredictionList {
  items: FailedPredictionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface RetryResponse {
  status: string;
  failed_id: string;
}

export const failedPredictionsApi = {
  list: (page = 1, pageSize = 50) =>
    apiClient.get<FailedPredictionList>(
      `/admin/failed-predictions?page=${page}&page_size=${pageSize}`,
    ),

  retry: (failedId: string) =>
    apiClient.post<RetryResponse>(`/admin/failed-predictions/${failedId}/retry`),
};
