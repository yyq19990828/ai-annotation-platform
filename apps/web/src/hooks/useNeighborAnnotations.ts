/**
 * v0.14.1 · 邻帧框叠加: 批量拉 prev/next task 的同 group_id annotations。
 *
 * - selectedGroupId=null → 整 hook 短路(不发请求), overlay 不渲染。
 * - 复用 ["annotations", taskId] 缓存键 → 与 useAnnotations 共享缓存, 切到邻帧
 *   task 时命中已拉数据, 不重复请求。
 * - 后端 GET /tasks/{id}/annotations 无 group_id 过滤参数, 故在 client 端按
 *   group_id 过滤(K≤5 → 最多 ±5 帧, ~10 个 task, 性能可接受)。
 */
import { useQueries } from "@tanstack/react-query";
import { tasksApi } from "@/api/tasks";
import type { AnnotationResponse } from "@/types";

export interface NeighborAnnotationsResult {
  /** taskId → 该 task 内 group_id === selectedGroupId 的 annotations。 */
  byTask: Record<string, AnnotationResponse[]>;
  isLoading: boolean;
}

export function useNeighborAnnotations(
  taskIds: string[],
  selectedGroupId: number | null,
): NeighborAnnotationsResult {
  const enabled = selectedGroupId != null && taskIds.length > 0;
  const uniqueIds = enabled ? Array.from(new Set(taskIds)) : [];

  const results = useQueries({
    queries: uniqueIds.map((tid) => ({
      queryKey: ["annotations", tid],
      queryFn: () => tasksApi.getAnnotations(tid),
      enabled,
      staleTime: 60 * 1000,
    })),
  });

  const byTask: Record<string, AnnotationResponse[]> = {};
  uniqueIds.forEach((tid, i) => {
    const rows = results[i]?.data ?? [];
    byTask[tid] = rows.filter((a) => a.group_id === selectedGroupId);
  });

  return { byTask, isLoading: results.some((r) => r.isLoading) };
}
