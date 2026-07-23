import type { CocoRleMaskRef } from "@/types";
import {
  prepareCocoRleGzipUpload,
  type CocoRle,
} from "@/pages/Workbench/stage/shared/geometry/maskRle";
import { apiClient } from "./client";

export const rasterMasksApi = {
  /** v0.23.6 · 获取图片掩码内容 (RasterMaskGeometry)。 */
  annotationRasterMaskContent: (annotationId: string) =>
    apiClient.get<CocoRle>(`/annotations/${annotationId}/mask-content`),
  /** 获取视频掩码关键帧内容 (video_track_mask)。 */
  annotationVideoMaskContent: (annotationId: string, frameIndex: number) =>
    apiClient.get<CocoRle>(`/annotations/${annotationId}/mask-content/${frameIndex}`),
  uploadTaskContent: async (taskId: string, rle: CocoRle) => {
    const gzip = await prepareCocoRleGzipUpload(rle);
    if (!gzip) {
      return apiClient.post<CocoRleMaskRef>(`/tasks/${taskId}/mask-content`, rle);
    }
    return apiClient.post<CocoRleMaskRef>(`/tasks/${taskId}/mask-content`, undefined, {
      body: gzip.body,
      headers: { "Content-Encoding": "gzip" },
    });
  },
};
