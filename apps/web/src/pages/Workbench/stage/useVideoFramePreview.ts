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

export interface VideoFramePreviewDiagnostics {
  cacheSize: number;
  inFlight: number;
  cacheHits: number;
  cacheMisses: number;
  requests: number;
  prefetchRequests: number;
  prefetchFrames: number;
  errors: number;
  unsupported: boolean;
  lastFrameIndex: number | null;
  lastStatus: VideoFramePreview["status"] | "idle";
}

interface UseVideoFramePreviewArgs {
  taskId: string | null | undefined;
  maxFrame: number;
  enabled?: boolean;
  width?: number;
  format?: VideoFramePreviewFormat;
}

const MAX_CACHE_ITEMS = 120;
const MAX_PENDING_RETRIES = 10;
const RETRY_DELAY_MS = 800;
const RETRY_INITIAL_DELAY_MS = 200;
const SCRUB_PREFETCH_HALF_WINDOW = 3;
const SCRUB_PREFETCH_MIN_STEP = 2;
const ANCHOR_PREFETCH_COUNT = 8;
const EMPTY_DIAGNOSTICS: VideoFramePreviewDiagnostics = {
  cacheSize: 0,
  inFlight: 0,
  cacheHits: 0,
  cacheMisses: 0,
  requests: 0,
  prefetchRequests: 0,
  prefetchFrames: 0,
  errors: 0,
  unsupported: false,
  lastFrameIndex: null,
  lastStatus: "idle",
};

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
  const [diagnostics, setDiagnostics] = useState<VideoFramePreviewDiagnostics>(EMPTY_DIAGNOSTICS);
  const cacheRef = useRef(new Map<string, VideoFramePreview>());
  const inFlightRef = useRef(new Set<string>());
  const unsupportedTaskRef = useRef<string | null>(null);
  const activeRequestKeyRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const scheduledFrameRef = useRef<number | null>(null);
  const lastPrefetchAnchorRef = useRef<number | null>(null);
  const anchorPrefetchedTaskRef = useRef<string | null>(null);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const patchDiagnostics = useCallback((patch: Partial<VideoFramePreviewDiagnostics>) => {
    setDiagnostics((cur) => ({
      ...cur,
      ...patch,
      cacheSize: patch.cacheSize ?? cacheRef.current.size,
      inFlight: patch.inFlight ?? inFlightRef.current.size,
      unsupported: patch.unsupported ?? (taskId ? unsupportedTaskRef.current === taskId : false),
    }));
  }, [taskId]);

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
    patchDiagnostics({ cacheSize: cache.size });
  }, [patchDiagnostics]);

  const fetchFrame = useCallback((
    frameIndex: number,
    requestId: number,
    retryAttempt: number,
  ) => {
    if (!taskId || !enabled || unsupportedTaskRef.current === taskId) return;
    const key = cacheKey(taskId, frameIndex, width, format);
    inFlightRef.current.add(key);
    setDiagnostics((cur) => ({
      ...cur,
      requests: cur.requests + 1,
      cacheSize: cacheRef.current.size,
      inFlight: inFlightRef.current.size,
      unsupported: taskId ? unsupportedTaskRef.current === taskId : false,
    }));
    void tasksApi.getVideoFrame(taskId, frameIndex, { width, format })
      .then((frame) => {
        inFlightRef.current.delete(key);
        if (requestSeqRef.current !== requestId) return;
        const next = previewFromFrame(frame, width, format);
        if (next.status !== "pending") remember(key, next);
        setPreview(next);
        setDiagnostics((cur) => ({
          ...cur,
          cacheSize: cacheRef.current.size,
          inFlight: inFlightRef.current.size,
          lastFrameIndex: next.frameIndex,
          lastStatus: next.status,
          errors: next.status === "error" ? cur.errors + 1 : cur.errors,
        }));
        if (next.status === "pending" && retryAttempt < MAX_PENDING_RETRIES) {
          // Exponential backoff: poll quickly after the first miss so frames
          // that finish extraction fast show up promptly, then back off to the
          // server hint / cap so a slow worker is not hammered.
          const expBase = Math.min(
            RETRY_INITIAL_DELAY_MS * Math.pow(2, retryAttempt),
            RETRY_DELAY_MS,
          );
          const hintMs = frame.retry_after ? frame.retry_after * 1000 : 0;
          const retryDelay = Math.min(Math.max(expBase, hintMs), RETRY_DELAY_MS);
          retryTimerRef.current = setTimeout(() => {
            fetchFrame(frameIndex, requestId, retryAttempt + 1);
          }, retryDelay);
        }
      })
      .catch((err: unknown) => {
        inFlightRef.current.delete(key);
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
          unsupportedTaskRef.current = taskId;
          if (requestSeqRef.current === requestId) setPreview(null);
          patchDiagnostics({ inFlight: inFlightRef.current.size, unsupported: true });
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
        setDiagnostics((cur) => ({
          ...cur,
          cacheSize: cacheRef.current.size,
          inFlight: inFlightRef.current.size,
          lastFrameIndex: next.frameIndex,
          lastStatus: next.status,
          errors: cur.errors + 1,
        }));
      });
  }, [enabled, format, patchDiagnostics, remember, taskId, width]);

  const cancelScheduledFetch = useCallback(() => {
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    scheduledFrameRef.current = null;
  }, []);

  const prefetch = useCallback((rawFrames: readonly number[]) => {
    if (!taskId || !enabled || unsupportedTaskRef.current === taskId) return;
    const frames = [...new Set(rawFrames.map((frame) => clampFrame(frame, maxFrame)))]
      .filter((frame) => !cacheRef.current.has(cacheKey(taskId, frame, width, format)))
      .slice(0, 50);
    if (frames.length === 0) return;
    setDiagnostics((cur) => ({
      ...cur,
      prefetchRequests: cur.prefetchRequests + 1,
      prefetchFrames: cur.prefetchFrames + frames.length,
    }));
    void Promise.resolve(tasksApi.prefetchVideoFrames(taskId, frames, { width, format }))
      .then((response) => {
        if (!response || !Array.isArray(response.frames)) return;
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
          patchDiagnostics({ unsupported: true });
        }
      });
  }, [enabled, format, maxFrame, patchDiagnostics, remember, taskId, width]);

  const scrubPrefetch = useCallback((anchor: number) => {
    if (!taskId || !enabled || unsupportedTaskRef.current === taskId) return;
    const last = lastPrefetchAnchorRef.current;
    if (last !== null && Math.abs(anchor - last) < SCRUB_PREFETCH_MIN_STEP) return;
    lastPrefetchAnchorRef.current = anchor;
    const frames: number[] = [];
    for (let offset = -SCRUB_PREFETCH_HALF_WINDOW; offset <= SCRUB_PREFETCH_HALF_WINDOW; offset++) {
      if (offset === 0) continue;
      const f = anchor + offset;
      if (f < 0 || f > maxFrame) continue;
      const key = cacheKey(taskId, f, width, format);
      if (cacheRef.current.has(key) || inFlightRef.current.has(key)) continue;
      frames.push(f);
    }
    if (frames.length === 0) return;
    setDiagnostics((cur) => ({
      ...cur,
      prefetchRequests: cur.prefetchRequests + 1,
      prefetchFrames: cur.prefetchFrames + frames.length,
    }));
    const pending = tasksApi.prefetchVideoFrames(taskId, frames, { width, format });
    void Promise.resolve(pending)
      .then((response) => {
        if (!response || !Array.isArray(response.frames)) return;
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
          patchDiagnostics({ unsupported: true });
        }
      });
  }, [enabled, format, maxFrame, patchDiagnostics, remember, taskId, width]);

  const seedAnchorsIfNeeded = useCallback(() => {
    if (!taskId || maxFrame <= 0) return;
    if (anchorPrefetchedTaskRef.current === taskId) return;
    anchorPrefetchedTaskRef.current = taskId;
    const anchors: number[] = [];
    const span = Math.max(1, ANCHOR_PREFETCH_COUNT - 1);
    for (let i = 0; i < ANCHOR_PREFETCH_COUNT; i++) {
      anchors.push(Math.round((i / span) * maxFrame));
    }
    // First scrub on a fresh task: seed evenly-spaced anchor frames so distant
    // jumps later (e.g. clicking a bookmark) land on a warm cache instead of a
    // cold worker.
    prefetch(anchors);
  }, [maxFrame, prefetch, taskId]);

  const flushScheduledFetch = useCallback(() => {
    rafHandleRef.current = null;
    const target = scheduledFrameRef.current;
    scheduledFrameRef.current = null;
    if (target === null || !taskId || !enabled || unsupportedTaskRef.current === taskId) return;
    const frameIndex = clampFrame(target, maxFrame);
    const key = cacheKey(taskId, frameIndex, width, format);
    const cached = cacheRef.current.get(key);
    if (cached) {
      // Window prefetch may have filled the cache between scheduling and flush.
      setPreview(cached);
      scrubPrefetch(frameIndex);
      seedAnchorsIfNeeded();
      return;
    }
    if (!inFlightRef.current.has(key)) {
      fetchFrame(frameIndex, requestSeqRef.current, 0);
    }
    scrubPrefetch(frameIndex);
    seedAnchorsIfNeeded();
  }, [enabled, fetchFrame, format, maxFrame, scrubPrefetch, seedAnchorsIfNeeded, taskId, width]);

  const previewFor = useCallback((rawFrameIndex: number | null) => {
    if (rawFrameIndex === null || !taskId || !enabled || unsupportedTaskRef.current === taskId) {
      cancelScheduledFetch();
      clearRetry();
      activeRequestKeyRef.current = null;
      requestSeqRef.current += 1;
      setPreview(null);
      return;
    }
    const frameIndex = clampFrame(rawFrameIndex, maxFrame);
    const key = cacheKey(taskId, frameIndex, width, format);
    const sameActiveRequest = activeRequestKeyRef.current === key;
    if (!sameActiveRequest) {
      clearRetry();
      activeRequestKeyRef.current = key;
      requestSeqRef.current += 1;
    }
    const cached = cacheRef.current.get(key);
    if (cached) {
      cancelScheduledFetch();
      setPreview(cached);
      setDiagnostics((cur) => ({
        ...cur,
        cacheHits: cur.cacheHits + 1,
        cacheSize: cacheRef.current.size,
        inFlight: inFlightRef.current.size,
        lastFrameIndex: cached.frameIndex,
        lastStatus: cached.status,
      }));
      return;
    }
    // Cache miss while scrubbing: keep the previous ready preview on screen so
    // the popover does not flash back to "Loading F X" between adjacent frames.
    // Only fall back to a pending placeholder if nothing has been shown yet.
    setPreview((prev) => {
      if (prev && prev.status === "ready") return prev;
      return { frameIndex, status: "pending", url: null, width, format, error: null };
    });
    setDiagnostics((cur) => ({
      ...cur,
      cacheMisses: cur.cacheMisses + 1,
      cacheSize: cacheRef.current.size,
      inFlight: inFlightRef.current.size,
      lastFrameIndex: frameIndex,
      lastStatus: "pending",
    }));
    // Coalesce rapid scrub events to one fetch per animation frame so fast
    // pointer moves don't fire one request per pixel.
    scheduledFrameRef.current = frameIndex;
    if (rafHandleRef.current === null) {
      rafHandleRef.current = requestAnimationFrame(flushScheduledFetch);
    }
  }, [cancelScheduledFetch, clearRetry, enabled, flushScheduledFetch, format, maxFrame, taskId, width]);

  const clear = useCallback(() => {
    cancelScheduledFetch();
    clearRetry();
    requestSeqRef.current += 1;
    activeRequestKeyRef.current = null;
    lastPrefetchAnchorRef.current = null;
    anchorPrefetchedTaskRef.current = null;
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setPreview(null);
    setDiagnostics({
      ...EMPTY_DIAGNOSTICS,
      unsupported: taskId ? unsupportedTaskRef.current === taskId : false,
    });
  }, [cancelScheduledFetch, clearRetry, taskId]);

  useEffect(() => {
    unsupportedTaskRef.current = null;
    clear();
  }, [clear, taskId]);

  useEffect(() => () => {
    cancelScheduledFetch();
    clearRetry();
  }, [cancelScheduledFetch, clearRetry]);

  return { preview, previewFor, prefetch, clear, diagnostics };
}
