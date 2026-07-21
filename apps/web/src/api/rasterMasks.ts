import type { CocoRleMaskRef } from "@/types";
import {
  prepareCocoRleGzipUpload,
  type CocoRle,
} from "@/pages/Workbench/stage/shared/geometry/maskRle";
import { apiClient } from "./client";

export const rasterMasksApi = {
  annotationContent: (annotationId: string, frameIndex: number) =>
    apiClient.get<CocoRle>(`/annotations/${annotationId}/mask-content/${frameIndex}`),
  uploadTaskContent: async (taskId: string, rle: CocoRle) => {
    const gzip = await prepareCocoRleGzipUpload(rle);
    if (!gzip) {
      return apiClient.post<CocoRleMaskRef>(`/tasks/${taskId}/mask-content`, rle);
    }
    return apiClient.post<CocoRleMaskRef>(
      `/tasks/${taskId}/mask-content`,
      undefined,
      {
        body: gzip.body,
        headers: { "Content-Encoding": "gzip" },
      },
    );
  },
};
