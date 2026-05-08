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

  /**
   * 采纳预测.
   * - shapeIndex 给定: 仅采纳指定 shape (画布单点采纳, 避免波及同 prediction 下其它框).
   * - 不传:           采纳整条 prediction 的所有 shape ("全部采纳"按钮).
   */
  accept: (taskId: string, predictionId: string, shapeIndex?: number) => {
    const qs = shapeIndex !== undefined ? `?shape_index=${shapeIndex}` : "";
    return apiClient.post<AnnotationResponse[]>(
      `/tasks/${taskId}/predictions/${predictionId}/accept${qs}`,
    );
  },
};
