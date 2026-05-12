import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { tasksApi } from "@/api/tasks";
import type { VideoFrameOut } from "@/types";

export type VideoFramePreviewFormat = "webp" | "jpeg";

export type VideoFramePreview =
  | {
      frameIndex: number;
      status: "pending";
      url: null;
      width: number;
      format: VideoFramePreviewFormat;
      error: null;
    }
  | {
      frameIndex: number;
      status: "ready";
      url: string;
      width: number;
      format: VideoFramePreviewFormat;
      error: null;
    }
  | {
      frameIndex: number;
      status: "error";
      url: null;
      width: number;
      format: VideoFramePreviewFormat;
      error: string;
    };

interface UseVideoFramePreviewArgs {
  taskId: string | null | undefined;
  maxFrame: number;
  enabled?: boolean;
  width?: number;
  format?: VideoFramePreviewFormat;
}

const MAX_CACHE_ITEMS = 120;
const RETRY_DELAY_MS = 800;

function clampFrame(frameIndex: number, maxFrame: number) {
  if (!Number.isFinite(frameIndex)) return 0;
  return Math.max(0, Math.min(maxFrame, Math.round(frameIndex)));
}

function cacheKey(taskId: string, frameIndex: number, width: number, format: VideoFramePreviewFormat) {
  return `${taskId}:${frameIndex}:${width}:${format}`;
}

function previewFromFrame(
  frame: VideoFrameOut,
  fallbackWidth: number,
  fallbackFormat: VideoFramePreviewFormat,
): VideoFramePreview {
  if (frame.status === "ready" && frame.url) {
    return {
      frameIndex: frame.frame_index,
      status: "ready",
      url: frame.url,
      width: frame.width,
      format: frame.format,
      error: null,
    };
  }
  if (frame.status === "failed") {
    return {
      frameIndex: frame.frame_index,
      status: "error",
      url: null,
      width: frame.width || fallbackWidth,
      format: frame.format || fallbackFormat,
      error: frame.error || "frame preview failed",
    };
  }
  return {
    frameIndex: frame.frame_index,
    status: "pending",
    url: null,
    width: frame.width || fallbackWidth,
    format: frame.format || fallbackFormat,
    error: null,
  };
}

export function useVideoFramePreview({
  taskId,
  maxFrame,
  enabled = true,
  width = 320,
  format = "webp",
}: UseVideoFramePreviewArgs) {
  const [preview, setPreview] = useState<VideoFramePreview | null>(null);
  const cacheRef = useRef(new Map<string, VideoFramePreview>());
  const inFlightRef = useRef(new Set<string>());
  const unsupportedTaskRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const remember = useCallback((key: string, value: VideoFramePreview) => {
    if (value.status === "pending") return;
    const cache = cacheRef.current;
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > MAX_CACHE_ITEMS) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const fetchFrame = useCallback((
    frameIndex: number,
    requestId: number,
    retryAttempt: number,
  ) => {
    if (!taskId || !enabled || unsupportedTaskRef.current === taskId) return;
    const key = cacheKey(taskId, frameIndex, width, format);
    inFlightRef.current.add(key);
    void tasksApi.getVideoFrame(taskId, frameIndex, { width, format })
      .then((frame) => {
        inFlightRef.current.delete(key);
        if (requestSeqRef.current !== requestId) return;
        const next = previewFromFrame(frame, width, format);
        if (next.status !== "pending") remember(key, next);
        setPreview(next);
        if (next.status === "pending" && retryAttempt < 1) {
          retryTimerRef.current = setTimeout(() => {
            fetchFrame(frameIndex, requestId, retryAttempt + 1);
          }, frame.retry_after ? frame.retry_after * 1000 : RETRY_DELAY_MS);
        }
      })
      .catch((err: unknown) => {
        inFlightRef.current.delete(key);
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
          unsupportedTaskRef.current = taskId;
          if (requestSeqRef.current === requestId) setPreview(null);
          return;
        }
        if (requestSeqRef.current !== requestId) return;
        const next: VideoFramePreview = {
          frameIndex,
          status: "error",
          url: null,
          width,
          format,
          error: err instanceof Error ? err.message : "frame preview failed",
        };
        remember(key, next);
        setPreview(next);
      });
  }, [enabled, format, remember, taskId, width]);

  const previewFor = useCallback((rawFrameIndex: number | null) => {
    clearRetry();
    requestSeqRef.current += 1;
    if (rawFrameIndex === null || !taskId || !enabled || unsupportedTaskRef.current === taskId) {
      setPreview(null);
      return;
    }
    const frameIndex = clampFrame(rawFrameIndex, maxFrame);
    const key = cacheKey(taskId, frameIndex, width, format);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setPreview(cached);
      return;
    }
    setPreview({ frameIndex, status: "pending", url: null, width, format, error: null });
    if (inFlightRef.current.has(key)) return;
    fetchFrame(frameIndex, requestSeqRef.current, 0);
  }, [clearRetry, enabled, fetchFrame, format, maxFrame, taskId, width]);

  const prefetch = useCallback((rawFrames: readonly number[]) => {
    if (!taskId || !enabled || unsupportedTaskRef.current === taskId) return;
    const frames = [...new Set(rawFrames.map((frame) => clampFrame(frame, maxFrame)))]
      .filter((frame) => !cacheRef.current.has(cacheKey(taskId, frame, width, format)))
      .slice(0, 50);
    if (frames.length === 0) return;
    void tasksApi.prefetchVideoFrames(taskId, frames, { width, format })
      .then((response) => {
        for (const frame of response.frames) {
          const next = previewFromFrame(frame, width, format);
          if (next.status !== "pending") {
            remember(cacheKey(taskId, next.frameIndex, width, format), next);
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
          unsupportedTaskRef.current = taskId;
        }
      });
  }, [enabled, format, maxFrame, remember, taskId, width]);

  const clear = useCallback(() => {
    clearRetry();
    requestSeqRef.current += 1;
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setPreview(null);
  }, [clearRetry]);

  useEffect(() => {
    unsupportedTaskRef.current = null;
    clear();
  }, [clear, taskId]);

  useEffect(() => () => clearRetry(), [clearRetry]);

  return { preview, previewFor, prefetch, clear };
}
