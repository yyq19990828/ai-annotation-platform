import { apiClient } from "./client";
import type { PredictionResponse, AnnotationResponse } from "@/types";

export const predictionsApi = {
  listByTask: (taskId: string, modelVersion?: string, minConfidence?: number, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (modelVersion) params.set("model_version", modelVersion);
    if (minConfidence !== undefined) params.set("min_confidence", String(minConfidence));
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined && offset > 0) params.set("offset", String(offset));
    const qs = params.size ? `?${params}` : "";
    return apiClient.get<PredictionResponse[]>(`/tasks/${taskId}/predictions${qs}`);
  },

  accept: (taskId: string, predictionId: string) =>
    apiClient.post<AnnotationResponse[]>(`/tasks/${taskId}/predictions/${predictionId}/accept`),
};
