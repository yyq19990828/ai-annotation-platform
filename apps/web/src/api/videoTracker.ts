import { apiClient } from "./client";

export type VideoTrackerDirection = "forward" | "backward" | "bidirectional";
export type VideoTrackerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface VideoTrackerJob {
  id: string;
  task_id: string;
  dataset_item_id: string;
  annotation_id: string;
  segment_id: string | null;
  created_by: string | null;
  status: VideoTrackerJobStatus;
  model_key: string;
  direction: VideoTrackerDirection;
  from_frame: number;
  to_frame: number;
  prompt: Record<string, unknown>;
  event_channel: string;
  celery_task_id: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface VideoTrackerPropagatePayload {
  from_frame: number;
  to_frame: number;
  model_key: string;
  direction: VideoTrackerDirection;
  segment_id?: string | null;
  prompt?: Record<string, unknown>;
}

export const videoTrackerApi = {
  propagate: (taskId: string, annotationId: string, payload: VideoTrackerPropagatePayload) =>
    apiClient.post<VideoTrackerJob>(
      `/tasks/${taskId}/video/tracks/${annotationId}:propagate`,
      payload,
    ),
  get: (jobId: string) =>
    apiClient.get<VideoTrackerJob>(`/video-tracker-jobs/${jobId}`),
  cancel: (jobId: string) =>
    apiClient.delete<VideoTrackerJob>(`/video-tracker-jobs/${jobId}`),
};
