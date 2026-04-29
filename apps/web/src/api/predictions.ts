import { apiClient } from "./client";
import type { PredictionResponse, AnnotationResponse } from "@/types";

export const predictionsApi = {
  listByTask: (taskId: string, modelVersion?: string, minConfidence?: number) => {
    const params = new URLSearchParams();
    if (modelVersion) params.set("model_version", modelVersion);
    if (minConfidence !== undefined) params.set("min_confidence", String(minConfidence));
    const qs = params.size ? `?${params}` : "";
    return apiClient.get<PredictionResponse[]>(`/tasks/${taskId}/predictions${qs}`);
  },

  accept: (taskId: string, predictionId: string) =>
    apiClient.post<AnnotationResponse[]>(`/tasks/${taskId}/predictions/${predictionId}/accept`),
};
