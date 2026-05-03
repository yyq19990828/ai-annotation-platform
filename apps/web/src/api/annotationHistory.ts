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
  annotation_id: string;
  task_id: string;
  entries: HistoryEntry[];
}

export const annotationHistoryApi = {
  get: (annotationId: string) =>
    apiClient.get<AnnotationHistoryResponse>(
      `/annotations/${annotationId}/history`,
    ),
};
