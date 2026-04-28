import { apiClient } from "./client";
import type { PredictionResponse, AnnotationResponse } from "@/types";

export const predictionsApi = {
  listByTask: (taskId: string, modelVersion?: string) => {
    const q = modelVersion ? `?model_version=${encodeURIComponent(modelVersion)}` : "";
    return apiClient.get<PredictionResponse[]>(`/tasks/${taskId}/predictions${q}`);
  },

  accept: (taskId: string, predictionId: string) =>
    apiClient.post<AnnotationResponse[]>(`/tasks/${taskId}/predictions/${predictionId}/accept`),
};
