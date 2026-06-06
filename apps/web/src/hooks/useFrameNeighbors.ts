/**
 * v0.14.1 · 跨帧目标延续: scene 内前后 k 个邻居 task。
 *
 * 纯包 v0.14.0 端点 GET /tasks/{id}/neighbors?k=K, 不感知几何类型 ——
 * 3D / 2D / 视频段 workbench 共用同一份。task 无 scene(历史未 backfill / 单帧)时
 * 端点回 scene_id=null(v0.14.1 起, 取代旧全零 UUID sentinel)+ 空 prev/next,
 * 调用方据此判定"无跨帧能力"。
 */
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "@/api/tasks";
import type { NeighborsResponse } from "@/types";

export function useFrameNeighbors(taskId: string | null | undefined, k = 1) {
  const query = useQuery({
    queryKey: ["frame-neighbors", taskId, k],
    queryFn: () => tasksApi.getNeighbors(taskId!, k),
    enabled: !!taskId,
    staleTime: 5 * 60 * 1000,
  });

  // propagate 前强刷一次避免缓存陈旧; 返回最新数据供 await 调用方直接消费。
  const refresh = async (): Promise<NeighborsResponse | null> => {
    const { data } = await query.refetch();
    return data ?? null;
  };

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh,
  };
}
