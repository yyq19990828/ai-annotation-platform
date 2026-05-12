import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { frameToTime, timeToFrame, type FrameTimebase } from "./frameTimebase";

type FrameMetadata = { mediaTime: number };
type VideoFrameCallback = (now: DOMHighResTimeStamp, metadata: FrameMetadata) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface FrameClockDiagnostics {
  seekCount: number;
  staleCallbacks: number;
  longTasks: number;
  lastSeekMs: number | null;
  lastFrameReadySource: "rvfc" | "seeked" | "timeupdate" | "raf" | "timeout" | null;
}

interface UseFrameClockOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  frameIndex: number;
  timebase: FrameTimebase;
  isPlaying: boolean;
  onFrameChange: (frameIndex: number) => void;
}

const SEEK_TIMEOUT_MS = 300;

function hasRequestVideoFrameCallback(video: HTMLVideoElement | null): boolean {
  return typeof (video as VideoWithFrameCallback | null)?.requestVideoFrameCallback === "function";
}

export function useFrameClock({
  videoRef,
  frameIndex,
  timebase,
  isPlaying,
  onFrameChange,
}: UseFrameClockOptions) {
  const [isSeeking, setIsSeeking] = useState(false);
  const [diagnostics, setDiagnostics] = useState<FrameClockDiagnostics>({
    seekCount: 0,
    staleCallbacks: 0,
    longTasks: 0,
    lastSeekMs: null,
    lastFrameReadySource: null,
  });
  const latestSeekIdRef = useRef(0);
  const seekStartedAtRef = useRef<number | null>(null);
  const diagnosticsRef = useRef(diagnostics);
  const targetFrameRef = useRef<number | null>(null);

  diagnosticsRef.current = diagnostics;

  const maxFrame = Math.max(0, timebase.frameCount - 1);
  const seekTolerance = useMemo(() => Math.max(0.001, 0.5 / timebase.fps), [timebase.fps]);

  const setDiagnosticsPatch = useCallback((patch: Partial<FrameClockDiagnostics>) => {
    setDiagnostics((cur) => {
      const next = { ...cur, ...patch };
      diagnosticsRef.current = next;
      return next;
    });
  }, []);

  const recordFrameReady = useCallback((source: FrameClockDiagnostics["lastFrameReadySource"], frame: number) => {
    const seekTarget = targetFrameRef.current;
    const seekStartedAt = seekStartedAtRef.current;
    if (seekTarget !== null && Math.abs(seekTarget - frame) <= 1) {
      targetFrameRef.current = null;
      seekStartedAtRef.current = null;
      setIsSeeking(false);
      setDiagnosticsPatch({
        lastFrameReadySource: source,
        lastSeekMs: seekStartedAt === null ? null : Math.round(performance.now() - seekStartedAt),
      });
      return;
    }
    setDiagnosticsPatch({ lastFrameReadySource: source });
  }, [setDiagnosticsPatch]);

  const updateFrameFromTime = useCallback((mediaTime: number, source: FrameClockDiagnostics["lastFrameReadySource"]) => {
    const nextFrame = timeToFrame(mediaTime, timebase);
    onFrameChange(nextFrame);
    recordFrameReady(source, nextFrame);
  }, [onFrameChange, recordFrameReady, timebase]);

  const seekTo = useCallback((nextFrame: number) => {
    const video = videoRef.current;
    const frame = Math.max(0, Math.min(maxFrame, Math.round(nextFrame)));
    const seekId = latestSeekIdRef.current + 1;
    latestSeekIdRef.current = seekId;
    targetFrameRef.current = frame;
    seekStartedAtRef.current = performance.now();
    setIsSeeking(true);
    setDiagnostics((cur) => {
      const next = { ...cur, seekCount: cur.seekCount + 1 };
      diagnosticsRef.current = next;
      return next;
    });
    onFrameChange(frame);

    if (!video) return;
    video.currentTime = frameToTime(frame, timebase);

    if (hasRequestVideoFrameCallback(video)) {
      const frameVideo = video as VideoWithFrameCallback;
      frameVideo.requestVideoFrameCallback?.((_now, metadata) => {
        if (seekId !== latestSeekIdRef.current) {
          const cur = diagnosticsRef.current;
          const next = { ...cur, staleCallbacks: cur.staleCallbacks + 1 };
          diagnosticsRef.current = next;
          setDiagnostics(next);
          return;
        }
        updateFrameFromTime(metadata.mediaTime, "rvfc");
      });
    }

    window.setTimeout(() => {
      if (seekId !== latestSeekIdRef.current || targetFrameRef.current === null) return;
      targetFrameRef.current = null;
      seekStartedAtRef.current = null;
      setIsSeeking(false);
      setDiagnosticsPatch({
        lastFrameReadySource: "timeout",
        lastSeekMs: null,
      });
    }, SEEK_TIMEOUT_MS);
  }, [maxFrame, onFrameChange, setDiagnosticsPatch, timebase, updateFrameFromTime, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = frameToTime(frameIndex, timebase);
    if (!Number.isFinite(nextTime)) return;
    if (Math.abs(video.currentTime - nextTime) > seekTolerance && !isPlaying) {
      video.currentTime = nextTime;
    }
  }, [frameIndex, isPlaying, seekTolerance, timebase, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onSeeked = () => updateFrameFromTime(video.currentTime, "seeked");
    const onTimeUpdate = () => updateFrameFromTime(video.currentTime, "timeupdate");
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [updateFrameFromTime, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;

    if (hasRequestVideoFrameCallback(video)) {
      const frameVideo = video as VideoWithFrameCallback;
      let handle = 0;
      const tick: VideoFrameCallback = (_now, metadata) => {
        updateFrameFromTime(metadata.mediaTime, "rvfc");
        handle = frameVideo.requestVideoFrameCallback?.(tick) ?? 0;
      };
      handle = frameVideo.requestVideoFrameCallback?.(tick) ?? 0;
      return () => {
        if (handle && frameVideo.cancelVideoFrameCallback) frameVideo.cancelVideoFrameCallback(handle);
      };
    }

    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : window.clearTimeout;
    let raf = 0;
    const tick = () => {
      updateFrameFromTime(video.currentTime, "raf");
      raf = schedule(tick);
    };
    raf = schedule(tick);
    return () => cancel(raf);
  }, [isPlaying, updateFrameFromTime, videoRef]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof PerformanceObserver === "undefined") return;
    const supportedEntryTypes = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes ?? [];
    if (!supportedEntryTypes.includes("longtask")) return;
    const observer = new PerformanceObserver((list) => {
      const count = list.getEntries().length;
      if (count === 0) return;
      setDiagnostics((cur) => {
        const next = { ...cur, longTasks: cur.longTasks + count };
        diagnosticsRef.current = next;
        return next;
      });
    });
    observer.observe({ entryTypes: ["longtask"] });
    return () => observer.disconnect();
  }, []);

  return {
    currentFrame: frameIndex,
    isSeeking,
    seekTo,
    diagnostics,
    diagnosticsRef,
  };
}
