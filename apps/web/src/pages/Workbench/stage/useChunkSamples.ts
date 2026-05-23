import { useQuery } from "@tanstack/react-query";
import { videoApi } from "@/api/videos";

interface UseChunkSamplesArgs {
  datasetItemId: string | null | undefined;
  chunkId: number | null | undefined;
  enabled?: boolean;
}

/**
 * v0.10.46 · 拉取某个 chunk 的 sample manifest (WebCodecs demux 用)。
 * chunk 生成后 samples 不变, 故 staleTime 设为 Infinity; 旧 chunk 无 samples 时
 * 端点返回 404, isError 为真, 调用方静默降级回 <video> 路径。
 */
export function useChunkSamples({ datasetItemId, chunkId, enabled = true }: UseChunkSamplesArgs) {
  return useQuery({
    queryKey: ["video-chunk-samples", datasetItemId, chunkId],
    queryFn: () => videoApi.getChunkSamples(datasetItemId!, chunkId!),
    enabled: enabled && datasetItemId != null && chunkId != null,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
    retry: false,
  });
}
