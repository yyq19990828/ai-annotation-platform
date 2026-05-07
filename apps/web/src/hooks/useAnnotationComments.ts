import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { commentsApi, type CreateCommentPayload } from "@/api/comments";

export function useAnnotationComments(annotationId: string | null | undefined) {
  return useQuery({
    queryKey: ["annotation-comments", annotationId],
    queryFn: () => commentsApi.listByAnnotation(annotationId!),
    enabled: !!annotationId,
  });
}

// v0.8.8 · keyset 分页 + 「加载更早评论」按钮。CommentsPanel 切换到这条 hook
// 后单标注 100+ 评论不再初始化卡顿；老 hook（`useAnnotationComments`）保留作
// 简单场景兜底（list_attachments 等）。
const COMMENTS_PAGE_LIMIT = 50;

export function useAnnotationCommentsInfinite(
  annotationId: string | null | undefined,
) {
  return useInfiniteQuery({
    queryKey: ["annotation-comments-page", annotationId],
    queryFn: ({ pageParam }) =>
      commentsApi.listByAnnotationKeyset(annotationId!, {
        limit: COMMENTS_PAGE_LIMIT,
        cursor: pageParam ?? undefined,
      }),
    enabled: !!annotationId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export function useCreateComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: string | CreateCommentPayload) => {
      if (!annotationId) throw new Error("No annotation selected");
      const body = typeof payload === "string" ? { body: payload } : payload;
      return commentsApi.create(annotationId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
      qc.invalidateQueries({ queryKey: ["annotation-comments-page", annotationId] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function usePatchComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { body?: string; is_resolved?: boolean } }) =>
      commentsApi.patch(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
      qc.invalidateQueries({ queryKey: ["annotation-comments-page", annotationId] });
    },
  });
}

export function useDeleteComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
      qc.invalidateQueries({ queryKey: ["annotation-comments-page", annotationId] });
    },
  });
}
