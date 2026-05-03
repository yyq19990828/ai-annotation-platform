import { useQuery } from "@tanstack/react-query";
import { annotationHistoryApi } from "@/api/annotationHistory";

/**
 * v0.7.2 · 拉取单个 annotation 的完整时间线（audit + comments + 关联 task 审核事件）。
 * 注意：本地 undo/redo 栈也叫 useAnnotationHistory（state/useAnnotationHistory.ts），
 * 这里命名为 useAnnotationAuditHistory 避免冲突。
 */
export function useAnnotationAuditHistory(annotationId: string | null) {
  return useQuery({
    queryKey: ["annotation-history", annotationId],
    queryFn: () => annotationHistoryApi.get(annotationId as string),
    enabled: !!annotationId,
    staleTime: 30 * 1000,
  });
}
