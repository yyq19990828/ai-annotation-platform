import { apiClient } from "./client";
import type { AnnotationCommentResponse } from "./comments";
import type { AnnotationFeedback } from "./feedbacks";
import type {
  DiscussionActions,
  DiscussionReadScope,
} from "@/pages/Workbench/state/discussionTypes";

export type {
  DiscussionActions,
  DiscussionReadScope,
} from "@/pages/Workbench/state/discussionTypes";

export type TaskDiscussionItem =
  | {
      source: "annotation_comment";
      data: AnnotationCommentResponse;
      actions: DiscussionActions;
    }
  | {
      source: "feedback";
      data: AnnotationFeedback;
      actions: DiscussionActions;
    };

export interface TaskDiscussionPage {
  items: TaskDiscussionItem[];
  next_cursor: string | null;
  total: number;
}

export interface AnnotationCommentCountsResponse {
  counts: Record<string, number>;
}

export interface ListTaskDiscussionParams {
  scope?: DiscussionReadScope;
  annotation_id?: string | null;
  limit?: number;
  cursor?: string | null;
}

function buildQuery(params: ListTaskDiscussionParams): string {
  const search = new URLSearchParams();
  if (params.scope) search.set("scope", params.scope);
  if (params.annotation_id) search.set("annotation_id", params.annotation_id);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Authoritative mixed-source task discussion read model.
 *
 * This is deliberately a separate client from feedbacksApi. The feed endpoint
 * owns ordering, totals and source provenance; independently paged source
 * lists must never be merged in the browser.
 */
export const discussionApi = {
  listTaskDiscussion: (
    taskId: string,
    params: ListTaskDiscussionParams = {},
    signal?: AbortSignal,
  ) =>
    apiClient.get<TaskDiscussionPage>(`/tasks/${taskId}/discussion/page${buildQuery(params)}`, {
      signal,
    }),
  getAnnotationCommentCounts: (taskId: string, signal?: AbortSignal) =>
    apiClient.get<AnnotationCommentCountsResponse>(
      `/tasks/${taskId}/discussion/annotation-counts`,
      { signal },
    ),
};

/** Compatibility alias for callers that name the resource explicitly. */
export const taskDiscussionApi = discussionApi;

/** Stable source-aware identity. Equal UUIDs in the two source tables are valid. */
export function discussionItemKey(item: Pick<TaskDiscussionItem, "source" | "data">): string {
  return `${item.source}:${item.data.id}`;
}

export function isAnnotationDiscussionItem(
  item: TaskDiscussionItem,
): item is Extract<TaskDiscussionItem, { source: "annotation_comment" }> {
  return item.source === "annotation_comment";
}

export function isFeedbackDiscussionItem(
  item: TaskDiscussionItem,
): item is Extract<TaskDiscussionItem, { source: "feedback" }> {
  return item.source === "feedback";
}
