import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { predictionsApi } from "@/api/predictions";
import type { PredictionResponse } from "@/types";

const PAGE_SIZE = 100;

/**
 * 跨 Prediction 按 shape 置信度 desc 分页加载。
 * 单个 Prediction 可能在多页中各出现一部分 shape，前端 flatMap 后无差别；
 * pageParam = 已加载的 shape 总数（offset）。
 */
export function usePredictions(
  taskId: string | undefined,
  modelVersion?: string,
  minConfidence?: number,
  pageSize: number = PAGE_SIZE,
) {
  return useInfiniteQuery({
    queryKey: ["predictions", taskId, modelVersion, minConfidence, pageSize],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      predictionsApi.listByTask(taskId!, modelVersion, minConfidence, pageSize, pageParam as number),
    getNextPageParam: (lastPage: PredictionResponse[], allPages) => {
      const lastShapes = lastPage.reduce((sum, p) => sum + (p.result?.length ?? 0), 0);
      if (lastShapes < pageSize) return undefined; // 这页就没填满，没下一页了
      return allPages.reduce((sum, page) => sum + page.reduce((s, p) => s + (p.result?.length ?? 0), 0), 0);
    },
    enabled: !!taskId,
  });
}

export function useAcceptPrediction(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (predictionId: string) => predictionsApi.accept(taskId, predictionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["predictions", taskId] });
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
    },
  });
}
