import { apiClient } from "./client";

/** v0.10.36 · /video-tracker-jobs — 视频追踪任务聚合监控.
 *
 * 后端返回任务执行态与候选审阅态。 */
export type VideoTrackerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "pending_review"
  | "partially_reviewed"
  | "accepted"
  | "discarded";

export interface VideoTrackerJobListItem {
  id: string;
  task_id: string | null;
  project_id: string;
  project_name: string | null;
  project_display_id: string | null;
  dataset_item_id: string | null;
  annotation_id: string | null;
  segment_id: string | null;
  created_by: string | null;
  status: VideoTrackerJobStatus;
  model_key: string | null;
  direction: string | null;
  from_frame: number | null;
  to_frame: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}

export type VideoTrackerJobCounts = Record<VideoTrackerJobStatus, number>;

export interface VideoTrackerJobsResponse {
  items: VideoTrackerJobListItem[];
  next_cursor: string | null;
  counts: VideoTrackerJobCounts;
}

export interface ListVideoTrackerJobsParams {
  project_id?: string;
  status?: VideoTrackerJobStatus;
  model_key?: string;
  cursor?: string;
  limit?: number;
}

export const videoTrackerJobsApi = {
  list: (params: ListVideoTrackerJobsParams = {}) => {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set("project_id", params.project_id);
    if (params.status) qs.set("status", params.status);
    if (params.model_key) qs.set("model_key", params.model_key);
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiClient.get<VideoTrackerJobsResponse>(
      `/video-tracker-jobs${suffix}`,
    );
  },
};
