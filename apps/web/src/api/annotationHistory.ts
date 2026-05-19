import { apiClient } from "./client";
import type { UserBrief } from "@/types";

export interface HistoryEntry {
  kind: "audit" | "comment";
  timestamp: string;
  actor: UserBrief | null;
  // audit
  action: string | null;
  detail: Record<string, unknown> | null;
  // comment
  comment_id: string | null;
  body: string | null;
}

export interface AnnotationHistoryResponse {
  // I4 · task 级时间线时 annotation_id=null.
  annotation_id: string | null;
  task_id: string;
  entries: HistoryEntry[];
}

export const annotationHistoryApi = {
  get: (annotationId: string) =>
    apiClient.get<AnnotationHistoryResponse>(
      `/annotations/${annotationId}/history`,
    ),
  // I4 · DiscussionPanel 未选中标注时降级到 task 级时间线.
  getByTask: (taskId: string) =>
    apiClient.get<AnnotationHistoryResponse>(
      `/tasks/${taskId}/audit-history`,
    ),
};
