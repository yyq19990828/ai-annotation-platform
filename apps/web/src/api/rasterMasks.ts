import type { CocoRleMaskRef } from "@/types";
import type { CocoRle } from "@/pages/Workbench/stage/shared/geometry/maskRle";
import { apiClient } from "./client";

export const rasterMasksApi = {
  annotationContent: (annotationId: string, frameIndex: number) =>
    apiClient.get<CocoRle>(`/annotations/${annotationId}/mask-content/${frameIndex}`),
  uploadTaskContent: (taskId: string, rle: CocoRle) =>
    apiClient.post<CocoRleMaskRef>(`/tasks/${taskId}/mask-content`, rle),
};
