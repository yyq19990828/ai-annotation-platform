import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "@/api/tasks";
import { videoApi } from "@/api/videos";
import type { VideoChunkOut, VideoChunkSamplesResponse, VideoManifestV2Response } from "@/types";
import { useVideoChunkDecoder } from "./useVideoChunkDecoder";
import { buildEncodedVideoDecodePlan, type PreciseFrameFallbackReason } from "./videoChunkDemux";
import type { CachedVideoBitmap } from "./useVideoBitmapCache";

export interface UseVideoPreciseFrameArgs {
  taskId: string | null | undefined;
  frameIndex: number;
  /** 暂停 + 非 seeking 时为 true(由调用方 frameClock / 播放态决定)。 */
  enabled: boolean;
  maxItems: number;
}

export type PreciseFrameSourceState =
  | "disabled"
  | "idle"
  | "chunk-pending"
  | "loading"
  | "decoding"
  | "ready"
  | "fallback";

export interface VideoPreciseFrameDiagnostics {
  decoderActive: boolean;
  chunkId: number | null;
  datasetItemId: string | null;
  chunkSizeFrames: number | null;
  decodeRequests: number;
  decoderErrors: number;
  urlRefreshed: boolean;
}

export interface UseVideoPreciseFrameResult {
  /** precise pipeline 是否激活(flag on + 浏览器支持)。 */
  active: boolean;
  /** 当前 frameIndex 的精确 bitmap(仅当 frameIndex 匹配时);否则 null(调用方走 fallback)。 */
  bitmap: CachedVideoBitmap | null;
  sourceState: PreciseFrameSourceState;
  fallbackReason: PreciseFrameFallbackReason | null;
  diagnostics: VideoPreciseFrameDiagnostics;
}

const BYTES_GC_MS = 60_000;
const MANIFEST_STALE_MS = 30_000;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 10_000;

interface ChunkBytesSource {
  targetKey: string;
  url: string;
  generation: number;
}

/** 由 query 阶段产生的 fallback reason(decode 阶段的 reason 由 decode effect 独立管理)。 */
const QUERY_FALLBACK_REASONS: readonly PreciseFrameFallbackReason[] = [
  "api_unavailable",
  "chunk_failed",
  "samples_unavailable",
  "chunk_fetch_failed",
];

export function retryAfterSecondsToMs(seconds: number | null | undefined): number {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return MIN_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(seconds * 1000)));
}

function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const v = (err as { status?: unknown }).status;
    return typeof v === "number" ? v : undefined;
  }
  return undefined;
}

/**
 * 精确帧 pipeline:manifest v2 → chunk 轮询 → samples → chunk bytes → demux plan → decode。
 *
 * 仅在暂停 + 稳定 seek 后(`enabled`)且 WebCodecs 可用时工作;连续播放与 seeking 中不发新
 * 请求。所有失败(manifest 缺失 / chunk pending-failed / samples 404 / bytes 网络错误 /
 * decode 失败)都安全 fallback,不阻断标注。latest-request-wins:旧 decode 可入缓存,但只有
 * 当前 `{taskId, frameIndex}` 能激活画面。
 */
export function useVideoPreciseFrame({
  taskId,
  frameIndex,
  enabled,
  maxItems,
}: UseVideoPreciseFrameArgs): UseVideoPreciseFrameResult {
  const decoder = useVideoChunkDecoder({ taskId, maxItems });
  const active = decoder.active;
  // 1-2. decoder inactive(无 flag / 无 WebCodecs)→ 全链路 disabled。
  const pipelineEnabled = active && !!taskId && enabled;

  const decoderRef = useRef(decoder);
  decoderRef.current = decoder;
  // latest-request-wins:effect 内异步 decode 完成后只激活仍匹配的 frame。
  const latestRef = useRef({ taskId, frameIndex, enabled });
  latestRef.current = { taskId, frameIndex, enabled };

  const [decoding, setDecoding] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<PreciseFrameFallbackReason | null>(null);
  const [urlRefreshed, setUrlRefreshed] = useState(false);
  const refreshedKeyRef = useRef<string | null>(null);
  const refreshingUrlKeyRef = useRef<string | null>(null);
  const [refreshingUrlKey, setRefreshingUrlKey] = useState<string | null>(null);
  const [bytesSource, setBytesSource] = useState<ChunkBytesSource | null>(null);
  const latestTargetKeyRef = useRef<string | null>(null);

  // 3. task manifest v2(仅 precise pipeline 激活时增量查询,不切主工作台 manifest)。
  const manifestQuery = useQuery({
    queryKey: ["video-manifest-v2", taskId],
    queryFn: ({ signal }) => tasksApi.getVideoManifestV2(taskId as string, { signal }),
    enabled: pipelineEnabled,
    staleTime: MANIFEST_STALE_MS,
    retry: false,
  });

  const manifest: VideoManifestV2Response | undefined = manifestQuery.data;
  const datasetItemId = manifest?.dataset_item_id ?? null;
  const chunkSizeFrames = manifest?.chunk_size_frames ?? null;
  const manifestValid =
    !!manifest &&
    !!manifest.dataset_item_id &&
    Number.isInteger(manifest.chunk_size_frames) &&
    manifest.chunk_size_frames > 0;

  // 4. 目标帧所在 chunk。
  const targetChunkId = useMemo(() => {
    if (!manifestValid || !manifest) return null;
    return Math.floor(Math.max(0, frameIndex) / manifest.chunk_size_frames);
  }, [manifestValid, manifest, frameIndex]);
  const targetKey =
    datasetItemId && targetChunkId !== null ? `${datasetItemId}:${targetChunkId}` : null;
  latestTargetKeyRef.current = targetKey;

  // 新帧先清旧 decode reason;跨 chunk / task 时还要重置 URL refresh 与 bytes source。
  useEffect(() => {
    setFallbackReason(null);
    setDecoding(false);
  }, [taskId, frameIndex]);
  useEffect(() => {
    refreshedKeyRef.current = null;
    refreshingUrlKeyRef.current = null;
    setRefreshingUrlKey(null);
    setUrlRefreshed(false);
    setBytesSource(null);
  }, [targetKey]);

  // 5. 单 chunk 状态:pending 按 retry_after 轮询;ready metadata 保留到显式 403 refresh。
  const chunkQuery = useQuery({
    queryKey: ["video-chunk", datasetItemId, targetChunkId],
    queryFn: ({ signal }) =>
      videoApi.getChunk(datasetItemId as string, targetChunkId as number, { signal }),
    enabled: pipelineEnabled && manifestValid && targetChunkId !== null && !!datasetItemId,
    refetchInterval: (query) => {
      const data = query.state.data as VideoChunkOut | undefined;
      if (data && data.status === "pending") {
        return retryAfterSecondsToMs(data.retry_after);
      }
      return false;
    },
    // ready metadata / signed URL 保持到显式 403 refresh;pending 仍由 refetchInterval 驱动。
    staleTime: Infinity,
    retry: false,
  });

  const chunk: VideoChunkOut | undefined = chunkQuery.data;
  const refetchChunk = chunkQuery.refetch;
  const chunkReady = !!chunk && chunk.status === "ready" && !!chunk.url;
  const chunkFailed = !!chunk && chunk.status === "failed";
  const chunkUrl = chunk?.url ?? null;

  // 6. packet sample manifest:按 dataset + chunk 长缓存(chunk 内容不变);404 不重试。
  const samplesQuery = useQuery({
    queryKey: ["video-chunk-samples", datasetItemId, targetChunkId],
    queryFn: ({ signal }) =>
      videoApi.getChunkSamples(datasetItemId as string, targetChunkId as number, { signal }),
    enabled: pipelineEnabled && chunkReady && !!datasetItemId,
    staleTime: Infinity,
    retry: false,
  });
  const samples: VideoChunkSamplesResponse | undefined = samplesQuery.data;

  useEffect(() => {
    if (!targetKey || !chunkReady || !chunkUrl) return;
    setBytesSource((current) =>
      current?.targetKey === targetKey ? current : { targetKey, url: chunkUrl, generation: 0 },
    );
  }, [chunkReady, chunkUrl, targetKey]);

  // 7. chunk bytes:raw fetch(signed URL,无需 auth header)。generation 仅在显式 403 refresh
  // 后递增,既不把敏感 signed URL 放进 query key,也能保证新 URL 必定发起一次新请求。
  const bytesQuery = useQuery({
    queryKey: ["video-chunk-bytes", datasetItemId, targetChunkId, bytesSource?.generation ?? 0],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const res = await fetch(bytesSource?.url as string, { signal });
      if (!res.ok) {
        const e = new Error(`chunk bytes HTTP ${res.status}`);
        (e as { status?: number }).status = res.status;
        throw e;
      }
      return res.arrayBuffer();
    },
    enabled:
      pipelineEnabled &&
      chunkReady &&
      !!samples &&
      !!datasetItemId &&
      !!targetKey &&
      bytesSource?.targetKey === targetKey &&
      !!bytesSource.url,
    // chunk 内容不可变;停用 / 卸载后仍由 gcTime 在 60s 后回收。
    staleTime: Infinity,
    gcTime: BYTES_GC_MS,
    retry: false,
    // v0.23.14 再升级为显式 byte LRU。
  });
  const bytes = bytesQuery.data;

  // signed URL 过期(403):先等待 chunk metadata 刷新完成,再递增 generation 触发新 URL bytes。
  // 同一 target visit 只刷新一次;第二次 403 进入 chunk_fetch_failed。
  useEffect(() => {
    if (!bytesQuery.isError || !targetKey || !bytesSource) return;
    if (errorStatus(bytesQuery.error) !== 403) return;
    if (refreshedKeyRef.current === targetKey) return;
    refreshedKeyRef.current = targetKey;
    refreshingUrlKeyRef.current = targetKey;
    setRefreshingUrlKey(targetKey);
    setUrlRefreshed(true);
    void refetchChunk()
      .then((result) => {
        if (latestTargetKeyRef.current !== targetKey) return;
        const refreshed = result.data;
        if (!result.isSuccess || refreshed?.status !== "ready" || !refreshed.url) return;
        setBytesSource((current) => {
          if (!current || current.targetKey !== targetKey) return current;
          return {
            targetKey,
            url: refreshed.url as string,
            generation: current.generation + 1,
          };
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (refreshingUrlKeyRef.current === targetKey) {
          refreshingUrlKeyRef.current = null;
        }
        setRefreshingUrlKey((current) => (current === targetKey ? null : current));
      });
  }, [bytesQuery.isError, bytesQuery.error, bytesSource, refetchChunk, targetKey]);

  // manifest / chunk / samples / bytes 的失败 → fallback reason(chunk_pending 是过渡态,不计)。
  // 仅覆盖 query 阶段 reason;decode 阶段 reason(invalid_sample_range / description_unavailable /
  // codec_unsupported / decode_failed)由 decode effect 独立设置与清除。
  useEffect(() => {
    let next: PreciseFrameFallbackReason | null = null;
    if (!pipelineEnabled) {
      next = null;
    } else if (manifestQuery.isError || (manifest && !manifestValid)) {
      next = "api_unavailable";
    } else if (chunkQuery.isError) {
      next = "api_unavailable";
    } else if (chunkFailed) {
      next = "chunk_failed";
    } else if (samplesQuery.isError) {
      next = errorStatus(samplesQuery.error) === 404 ? "samples_unavailable" : "api_unavailable";
    } else if (bytesQuery.isError) {
      const status = errorStatus(bytesQuery.error);
      const refreshing =
        status === 403 &&
        targetKey !== null &&
        (refreshingUrlKeyRef.current === targetKey || refreshingUrlKey === targetKey);
      if (!refreshing) next = "chunk_fetch_failed";
    }
    setFallbackReason((cur) => {
      if (next) return next;
      // 无 query 错误时,清除遗留的 query 类 reason;保留 decode 类 reason。
      if (cur && QUERY_FALLBACK_REASONS.includes(cur)) return null;
      return cur;
    });
  }, [
    pipelineEnabled,
    manifestQuery.isError,
    manifest,
    manifestValid,
    chunkQuery.isError,
    chunkFailed,
    samplesQuery.isError,
    samplesQuery.error,
    bytesQuery.isError,
    bytesQuery.error,
    targetKey,
    refreshingUrlKey,
  ]);

  // 8-10. bytes + samples 就绪 → build plan → decode → 仅当最新 ref 匹配才激活。
  useEffect(() => {
    if (!pipelineEnabled || !bytes || !samples || targetChunkId === null || !datasetItemId) {
      return;
    }
    const result = buildEncodedVideoDecodePlan(bytes, samples, frameIndex);
    if (!result.ok) {
      setFallbackReason(result.reason);
      setDecoding(false);
      return;
    }
    let cancelled = false;
    setDecoding(true);
    setFallbackReason(null);
    void (async () => {
      const decoded = await decoderRef.current.decodePlan(result.plan);
      if (cancelled) return;
      setDecoding(false);
      const latest = latestRef.current;
      if (latest.taskId !== taskId || latest.frameIndex !== frameIndex || !latest.enabled) {
        return; // latest-request-wins:旧 decode 不激活
      }
      if (!decoded.bitmap) {
        setFallbackReason(decoded.fallbackReason);
        return;
      }
      const shown = decoderRef.current.showFrame(frameIndex);
      if (!shown || shown.frameIndex !== frameIndex) {
        setFallbackReason("decode_failed");
        return;
      }
      setFallbackReason(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, samples, frameIndex, targetChunkId, datasetItemId, pipelineEnabled, taskId]);

  const bitmap = useMemo<CachedVideoBitmap | null>(() => {
    const ab = decoder.activeBitmap;
    if (ab && ab.frameIndex === frameIndex) return ab;
    return null;
  }, [decoder.activeBitmap, frameIndex]);

  const sourceState = useMemo<PreciseFrameSourceState>(() => {
    if (!pipelineEnabled) return "disabled";
    if (fallbackReason) return "fallback";
    if (bitmap) return "ready";
    if (decoding) return "decoding";
    if (chunk?.status === "pending") return "chunk-pending";
    if (chunkReady) return "loading";
    return "idle";
  }, [pipelineEnabled, fallbackReason, bitmap, decoding, chunk, chunkReady]);

  const diagnostics = useMemo<VideoPreciseFrameDiagnostics>(
    () => ({
      decoderActive: active,
      chunkId: targetChunkId,
      datasetItemId,
      chunkSizeFrames,
      decodeRequests: decoder.diagnostics.decodes,
      decoderErrors: decoder.diagnostics.errors,
      urlRefreshed,
    }),
    [
      active,
      targetChunkId,
      datasetItemId,
      chunkSizeFrames,
      decoder.diagnostics.decodes,
      decoder.diagnostics.errors,
      urlRefreshed,
    ],
  );

  return {
    active,
    bitmap,
    sourceState,
    fallbackReason,
    diagnostics,
  };
}
