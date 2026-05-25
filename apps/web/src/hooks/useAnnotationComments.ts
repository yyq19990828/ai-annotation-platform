import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useToastStore } from "@/components/ui/Toast";
import {
  commentsApi,
  type AnnotationCommentListPage,
  type AnnotationCommentResponse,
  type CreateCommentPayload,
} from "@/api/comments";

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

/**
 * I4 · 任务级评论 — DiscussionPanel 未选中标注时降级展示.
 */
export function useTaskCommentsInfinite(
  taskId: string | null | undefined,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ["task-comments-page", taskId],
    queryFn: ({ pageParam }) =>
      commentsApi.listByTaskKeyset(taskId!, {
        limit: COMMENTS_PAGE_LIMIT,
        cursor: pageParam ?? undefined,
      }),
    enabled: enabled && !!taskId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export function useCreateComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  return useMutation({
    mutationFn: (payload: string | CreateCommentPayload) => {
      if (!annotationId) throw new Error("No annotation selected");
      const body = typeof payload === "string" ? { body: payload } : payload;
      return commentsApi.create(annotationId, body);
    },
    onError: (e) => pushToast({ msg: "评论发送失败", sub: String(e), kind: "error" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
      qc.invalidateQueries({ queryKey: ["annotation-comments-page", annotationId] });
      // 任务级聚合视图（未选中标注）下 annotationId 为 null，上面的 key 命中不到
      // ["task-comments-page", taskId]；按前缀失效任务级缓存，保证汇总列表即时刷新。
      qc.invalidateQueries({ queryKey: ["task-comments-page"] });
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
      qc.invalidateQueries({ queryKey: ["task-comments-page"] });
    },
  });
}

export function useDeleteComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  const pageKey = ["annotation-comments-page", annotationId];
  const listKey = ["annotation-comments", annotationId];
  return useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    // 乐观移除：直接从缓存剔除被删项。后端是软删 (is_active=false) + 列表过滤，
    // 仅靠 invalidate+refetch 在快速切换标注时会偶现"删除后重现"（stale 缓存竞态）。
    // 直接改缓存条目可彻底避免；失败则在 onError 回滚（不掩盖失败的删除）。
    onMutate: async (id: string) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: pageKey }),
        qc.cancelQueries({ queryKey: listKey }),
      ]);
      const prevPages = qc.getQueryData<InfiniteData<AnnotationCommentListPage>>(pageKey);
      const prevList = qc.getQueryData<AnnotationCommentResponse[]>(listKey);
      qc.setQueryData<InfiniteData<AnnotationCommentListPage>>(pageKey, (old) =>
        old
          ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== id) })) }
          : old,
      );
      qc.setQueryData<AnnotationCommentResponse[]>(listKey, (old) =>
        old ? old.filter((c) => c.id !== id) : old,
      );
      return { prevPages, prevList };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prevPages !== undefined) qc.setQueryData(pageKey, ctx.prevPages);
      if (ctx?.prevList !== undefined) qc.setQueryData(listKey, ctx.prevList);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: pageKey });
      qc.invalidateQueries({ queryKey: ["task-comments-page"] });
    },
  });
}
