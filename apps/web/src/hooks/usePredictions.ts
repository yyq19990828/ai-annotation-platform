import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { predictionsApi } from "@/api/predictions";

export function usePredictions(taskId: string | undefined, modelVersion?: string) {
  return useQuery({
    queryKey: ["predictions", taskId, modelVersion],
    queryFn: () => predictionsApi.listByTask(taskId!, modelVersion),
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
