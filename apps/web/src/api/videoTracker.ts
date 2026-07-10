import { apiClient } from "./client";

export type VideoTrackerDirection = "forward" | "backward" | "bidirectional";
export type VideoTrackerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  // v0.21.28 · 候选/接受流。pending_review = 追踪完、结果暂存待审; accepted = 已落库;
  // discarded = 已丢弃。
  | "pending_review"
  | "accepted"
  | "discarded";

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

/** v0.21.19 · text-driven 追踪的视觉示例框 (归一化 xyxy)。复用 sam3 图片侧 Exemplar 形状。 */
export interface VideoTrackerExemplar {
  bbox: [number, number, number, number];
  label?: boolean;
}

export interface VideoTrackerPropagatePayload {
  from_frame: number;
  to_frame: number;
  model_key: string;
  direction: VideoTrackerDirection;
  segment_id?: string | null;
  prompt?: Record<string, unknown>;
  // v0.10.36: SAM 模型尺寸 (tiny/small/base_plus/large); 省略时后端回退 tiny。
  sam_variant?: string;
  // v0.21.19: text-driven 追踪 (sam3_video) 的文本 query + 可选视觉示例框。
  text?: string;
  exemplars?: VideoTrackerExemplar[];
}

/** v0.21.28 · 候选预览: job 暂存的逐帧结果, 供接受前渲染候选叠加。 */
export interface VideoTrackerPreviewResult {
  frame_index: number;
  geometry: Record<string, unknown>;
  confidence?: number | null;
  outside?: boolean;
  instance_id?: string | null;
  primary?: boolean;
}

export interface VideoTrackerJobPreview {
  job_id: string;
  status: VideoTrackerJobStatus;
  annotation_id: string;
  results: VideoTrackerPreviewResult[];
  grid_step: number;
  output_geometry: string;
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
  // v0.21.28 · 候选/接受流。
  preview: (jobId: string) =>
    apiClient.get<VideoTrackerJobPreview>(`/video-tracker-jobs/${jobId}/preview`),
  accept: (jobId: string) =>
    apiClient.post<VideoTrackerJob>(`/video-tracker-jobs/${jobId}/accept`, {}),
  discard: (jobId: string) =>
    apiClient.post<VideoTrackerJob>(`/video-tracker-jobs/${jobId}/discard`, {}),
};
