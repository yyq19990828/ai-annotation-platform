import { apiClient } from "./client";

export interface PreannotateQueueItem {
  batch_id: string;
  batch_name: string;
  batch_status: string;
  project_id: string;
  project_name: string;
  project_display_id?: string | null;
  total_tasks: number;
  prediction_count: number;
  failed_count: number;
  last_run_at?: string | null;
  can_retry: boolean;
}

export interface PreannotateQueueResponse {
  items: PreannotateQueueItem[];
}

export const adminPreannotateApi = {
  /** v0.9.6 · 列出 pre_annotated 状态批次 + prediction/failed 计数. */
  queue: (limit = 50) =>
    apiClient.get<PreannotateQueueResponse>(
      `/admin/preannotate-queue?limit=${limit}`,
    ),
};
