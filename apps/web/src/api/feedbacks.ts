/**
 * I18 · AnnotationFeedback 统一反馈表 API client.
 *
 * 端点列表见 docs/adr/archive/0027-annotation-feedback-unified-table.md.
 * pixel anchor 携带相对 0-1 坐标，并可选携带 Mask 质检区域与边界摘要。
 */
import { apiClient } from "./client";

export type FeedbackKind = "issue" | "comment" | "reject" | "bug";
export type FeedbackAnchorType = "project" | "task" | "annotation" | "pixel";
export type FeedbackStatus = "open" | "resolved" | "wont_fix";
export type FeedbackSeverity = "info" | "warn" | "blocker";

export interface MaskFeedbackCompareLocator {
  baseline_kind: "previous_version" | "tracker_candidate" | "ai_candidate" | "neighbor_keyframe";
  mode: "overlay" | "boundary" | "xor" | "added" | "removed";
  current_digest: string;
  baseline_digest: string;
  candidate_job_id?: string | null;
  candidate_job_revision?: number | null;
  candidate_digest?: string | null;
  candidate_instance_id?: string | null;
}

export interface FeedbackAnchorPosition {
  x: number;
  y: number;
  frame?: number | null;
  region_bbox?: [number, number, number, number] | null;
  region_digest?: string | null;
  boundary_digest?: string | null;
  mask_qc_issue_id?: string | null;
  compare_locator?: MaskFeedbackCompareLocator | null;
}

export interface AnnotationFeedback {
  id: string;
  kind: FeedbackKind;
  anchor_type: FeedbackAnchorType;
  project_id: string;
  task_id: string | null;
  annotation_id: string | null;
  anchor_position: FeedbackAnchorPosition | null;
  status: FeedbackStatus;
  severity: FeedbackSeverity | null;
  title: string | null;
  body: string;
  author_id: string;
  author_name: string | null;
  attachments: Array<Record<string, unknown>>;
  thread_parent_id: string | null;
  is_active: boolean;
  resolved_at: string | null;
  resolved_by_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AnnotationFeedbackListPage {
  items: AnnotationFeedback[];
  next_cursor: string | null;
}

export interface CreateFeedbackPayload {
  kind: FeedbackKind;
  anchor_type: FeedbackAnchorType;
  project_id: string;
  task_id?: string | null;
  annotation_id?: string | null;
  anchor_position?: FeedbackAnchorPosition | null;
  severity?: FeedbackSeverity | null;
  title?: string | null;
  body: string;
  attachments?: Array<Record<string, unknown>>;
  thread_parent_id?: string | null;
}

export interface PatchFeedbackPayload {
  status?: FeedbackStatus;
  severity?: FeedbackSeverity;
  title?: string;
  body?: string;
}

export interface ListFeedbacksParams {
  project_id: string;
  task_id?: string;
  annotation_id?: string;
  kind?: FeedbackKind;
  anchor_type?: FeedbackAnchorType;
  status?: FeedbackStatus;
  limit?: number;
  cursor?: string;
}

function buildQuery(params: ListFeedbacksParams): string {
  const sp = new URLSearchParams();
  const entries = Object.entries(params) as Array<[string, unknown]>;
  for (const [k, v] of entries) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const feedbacksApi = {
  list: (params: ListFeedbacksParams, signal?: AbortSignal) =>
    apiClient.get<AnnotationFeedbackListPage>(`/feedbacks${buildQuery(params)}`, { signal }),

  create: (payload: CreateFeedbackPayload) =>
    apiClient.post<AnnotationFeedback>("/feedbacks", payload),

  patch: (id: string, payload: PatchFeedbackPayload) =>
    apiClient.patch<AnnotationFeedback>(`/feedbacks/${id}`, payload),

  remove: (id: string) => apiClient.delete<void>(`/feedbacks/${id}`),

  reply: (id: string, payload: { body: string; attachments?: Array<Record<string, unknown>> }) =>
    apiClient.post<AnnotationFeedback>(`/feedbacks/${id}/replies`, payload),
};
