import { apiClient } from "./client";
import type { VideoChunksResponse, VideoChunkSamplesResponse } from "@/types";

/** 视频 chunk / sample manifest 相关 API (WebCodecs demux 链路, v0.10.46)。 */
export const videoApi = {
  getChunks: (datasetItemId: string) =>
    apiClient.get<VideoChunksResponse>(`/videos/${datasetItemId}/chunks`),
  getChunkSamples: (datasetItemId: string, chunkId: number) =>
    apiClient.get<VideoChunkSamplesResponse>(
      `/videos/${datasetItemId}/chunks/${chunkId}/samples`,
    ),
};
