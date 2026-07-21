import { apiClient } from "./client";
import type { CocoRleMaskRef } from "@/types";

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
  | "partially_reviewed"
  | "accepted"
  | "discarded";

export interface VideoTrackerJob {
  id: string;
  task_id: string;
  dataset_item_id: string;
  annotation_id: string | null;
  segment_id: string | null;
  created_by: string | null;
  status: VideoTrackerJobStatus;
  revision?: number;
  review_replayed?: boolean;
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
  output_geometry?: "bbox" | "polygon" | "mask";
  // v0.22.1 · B · 无源检测 (画布级发起): source_annotation_id 缺省 = 无源, 新建轨迹类别
  // 由 target_class_name/target_tool_unit_id 显式指定。有源延展时留空 (从 path / 继承源)。
  source_annotation_id?: string | null;
  target_class_name?: string | null;
  target_tool_unit_id?: string | null;
  // v0.22.2 · M2 · 多选批量: ≥2 条已有轨迹一次延展 (单 job 多源)。后端逐源读当前帧几何构
  // prompt.seeds[] (obj_id + source_annotation_id), 各回填各自源。给出时 track 走多源分支。
  source_annotation_ids?: string[] | null;
}

/** v0.21.28 · 候选预览: job 暂存的逐帧结果, 供接受前渲染候选叠加。 */
export type VideoTrackerPreviewGeometry =
  | { type: "bbox"; x: number; y: number; w: number; h: number }
  | { type: "polygon"; points: [number, number][] }
  | {
      type: "mask";
      mask: CocoRleMaskRef;
      bbox?: { x: number; y: number; w: number; h: number };
    };

export interface VideoTrackerPreviewResult {
  frame_index: number;
  geometry: VideoTrackerPreviewGeometry;
  confidence?: number | null;
  outside?: boolean;
  instance_id?: string | null;
  primary?: boolean;
  candidate_key?: string;
  geometry_digest?: string;
  source_annotation_id?: string | null;
  target_annotation_id?: string | null;
  manual_protected?: boolean;
}

export interface VideoTrackerJobPreview {
  job_id: string;
  status: VideoTrackerJobStatus;
  annotation_id: string | null;
  results: VideoTrackerPreviewResult[];
  grid_step: number;
  output_geometry: string;
  job_revision?: number;
  expected_source_versions?: Record<string, number>;
  candidate_total?: number;
  candidate_pending?: number;
  candidate_accepted?: number;
  candidate_rejected?: number;
}

export interface VideoTrackerDecisionPayload {
  instance_ids: string[];
  from_frame: number;
  to_frame: number;
  decision: "accept" | "reject";
  expected_source_versions: Record<string, number>;
  job_revision: number;
  override_manual?: boolean;
}

export const videoTrackerApi = {
  propagate: (taskId: string, annotationId: string, payload: VideoTrackerPropagatePayload) =>
    apiClient.post<VideoTrackerJob>(
      `/tasks/${taskId}/video/tracks/${annotationId}:propagate`,
      payload,
    ),
  // v0.22.1 · B · 任务级追踪 (画布级入口, 源可选): payload.source_annotation_id 给出即延展
  // 该轨迹, 缺省则为无源检测。
  track: (taskId: string, payload: VideoTrackerPropagatePayload) =>
    apiClient.post<VideoTrackerJob>(`/tasks/${taskId}/video:track`, payload),
  get: (jobId: string) =>
    apiClient.get<VideoTrackerJob>(`/video-tracker-jobs/${jobId}`),
  reviewable: (taskId: string) =>
    apiClient.get<VideoTrackerJob[]>(
      `/tasks/${taskId}/video/tracker-jobs/reviewable`,
    ),
  // v0.21.28 · 刷新后重连: 该 task 下仍在运行 (queued/running) 的追踪任务。
  active: (taskId: string) =>
    apiClient.get<VideoTrackerJob[]>(
      `/tasks/${taskId}/video/tracker-jobs/active`,
    ),
  cancel: (jobId: string) =>
    apiClient.delete<VideoTrackerJob>(`/video-tracker-jobs/${jobId}`),
  // v0.21.28 · 候选/接受流。
  preview: (jobId: string) =>
    apiClient.get<VideoTrackerJobPreview>(`/video-tracker-jobs/${jobId}/preview`),
  maskContent: (jobId: string, sha256: string) =>
    apiClient.get<import("@/pages/Workbench/stage/shared/geometry/maskRle").CocoRle>(
      `/video-tracker-jobs/${jobId}/mask-content/${sha256}`,
    ),
  accept: (jobId: string) =>
    apiClient.post<VideoTrackerJob>(`/video-tracker-jobs/${jobId}/accept`, {}),
  discard: (jobId: string) =>
    apiClient.post<VideoTrackerJob>(`/video-tracker-jobs/${jobId}/discard`, {}),
  decide: (jobId: string, payload: VideoTrackerDecisionPayload) =>
    apiClient.post<VideoTrackerJob>(`/video-tracker-jobs/${jobId}/decisions`, payload),
};
