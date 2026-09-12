import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import {
  discussionApi,
  discussionItemKey,
  type TaskDiscussionItem,
  type TaskDiscussionPage,
} from "@/api/discussion";
import { discussionKeys, type DiscussionReadScope } from "@/pages/Workbench/state/discussionTypes";
import { useAuthStore } from "@/stores/authStore";

export const TASK_DISCUSSION_PAGE_LIMIT = 50;

/**
 * Fetch the server-ordered mixed task discussion feed. Pagination is owned by
 * the endpoint, so this hook never combines independently paged annotation and
 * feedback lists in the browser.
 */
export function useTaskDiscussion(
  taskId: string | null | undefined,
  scope: DiscussionReadScope = "all",
  annotationId: string | null | undefined = null,
  enabled = true,
  projectId: string | null | undefined = null,
) {
  const effectiveAnnotationId = scope === "annotation" ? annotationId : null;
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useInfiniteQuery({
    // Keep the frozen C0 family prefix for mutation invalidation, then isolate
    // the user/project-sensitive action projection from another auth/project.
    queryKey: taskDiscussionQueryKey(taskId ?? "", scope, effectiveAnnotationId, projectId, userId),
    queryFn: ({ pageParam, signal }) =>
      discussionApi.listTaskDiscussion(
        taskId!,
        {
          scope,
          annotation_id: effectiveAnnotationId,
          limit: TASK_DISCUSSION_PAGE_LIMIT,
          cursor: pageParam ?? undefined,
        },
        signal,
      ),
    enabled: enabled && !!taskId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 30 * 1000,
  });
}

/** Query-key helper for mutation owners that need to invalidate a feed. */
export function taskDiscussionQueryKey(
  taskId: string,
  scope: DiscussionReadScope = "all",
  annotationId: string | null | undefined = null,
  projectId: string | null | undefined = null,
  userId: string | null | undefined = null,
) {
  return [
    ...discussionKeys.feed(
      taskId,
      scope,
      scope === "annotation" ? annotationId : null,
      TASK_DISCUSSION_PAGE_LIMIT,
    ),
    projectId ?? null,
    userId ?? null,
  ] as const;
}

/**
 * Flatten pages while retaining the server order and source-aware identity.
 * React Query can briefly expose a previous page during refetch; the identity
 * guard keeps a row from rendering twice without collapsing equal UUIDs from
 * the two authoritative source tables.
 */
export function flattenTaskDiscussion(
  data: InfiniteData<TaskDiscussionPage> | undefined,
): TaskDiscussionItem[] {
  const seen = new Set<string>();
  const items: TaskDiscussionItem[] = [];
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      const key = discussionItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}
