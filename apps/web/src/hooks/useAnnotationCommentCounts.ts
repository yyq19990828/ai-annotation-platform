import { useQuery } from "@tanstack/react-query";
import { discussionApi } from "@/api/discussion";
import { discussionKeys } from "@/pages/Workbench/state/discussionTypes";
import { useAuthStore } from "@/stores/authStore";

/** Stable task-level summary key; mutations invalidate its task-discussion prefix. */
export function annotationCommentCountsQueryKey(
  taskId: string,
  projectId: string | null | undefined,
  userId: string | null | undefined,
) {
  return [
    ...discussionKeys.task(taskId),
    "annotation-counts",
    projectId ?? null,
    userId ?? null,
  ] as const;
}

/** Fetch authoritative per-annotation totals in one request for image workbenches. */
export function useAnnotationCommentCounts(
  taskId: string | null | undefined,
  projectId: string | null | undefined,
  enabled = true,
) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery({
    queryKey: annotationCommentCountsQueryKey(taskId ?? "", projectId, userId),
    queryFn: ({ signal }) => discussionApi.getAnnotationCommentCounts(taskId!, signal),
    enabled: enabled && !!taskId,
    staleTime: 30 * 1000,
  });
}
