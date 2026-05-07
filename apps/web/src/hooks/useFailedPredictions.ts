/**
 * v0.8.6 F6 · 失败预测列表 + 重试 mutation。
 *
 * ws 推送 `failed_prediction.retry.{started,succeeded,failed}` 事件由
 * useNotificationSocket 监听并 invalidate 此 query；本 hook 只负责拉取与触发。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { failedPredictionsApi } from "@/api/failed-predictions";

export function useFailedPredictions(page = 1, pageSize = 50) {
  return useQuery({
    queryKey: ["admin", "failed-predictions", page, pageSize],
    queryFn: () => failedPredictionsApi.list(page, pageSize),
  });
}

export function useRetryFailedPrediction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (failedId: string) => failedPredictionsApi.retry(failedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "failed-predictions"] });
    },
  });
}
