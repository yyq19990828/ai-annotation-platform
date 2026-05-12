import type { TaskVideoFrameTimetableResponse, VideoMetadata } from "@/types";

export interface FrameTimebase {
  fps: number;
  frameCount: number;
  source: "ffprobe" | "estimated";
  ptsMs: number[] | null;
}

const DEFAULT_FPS = 30;

function clampFrame(frameIndex: number, frameCount: number) {
  const maxFrame = Math.max(0, frameCount - 1);
  if (!Number.isFinite(frameIndex)) return 0;
  return Math.max(0, Math.min(maxFrame, Math.round(frameIndex)));
}

function findClosestFrame(ptsMs: number[], targetMs: number) {
  let lo = 0;
  let hi = ptsMs.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ptsMs[mid] < targetMs) lo = mid + 1;
    else hi = mid - 1;
  }
  if (lo <= 0) return 0;
  if (lo >= ptsMs.length) return ptsMs.length - 1;
  const prev = lo - 1;
  return Math.abs(ptsMs[prev] - targetMs) <= Math.abs(ptsMs[lo] - targetMs) ? prev : lo;
}

export function buildFrameTimebase(
  metadata: VideoMetadata | undefined,
  timetable?: TaskVideoFrameTimetableResponse,
): FrameTimebase {
  const fps = metadata?.fps && metadata.fps > 0
    ? metadata.fps
    : (timetable?.fps && timetable.fps > 0 ? timetable.fps : DEFAULT_FPS);
  const lastTimetableFrame = timetable?.frames[timetable.frames.length - 1];
  const timetableFrameCount = lastTimetableFrame ? lastTimetableFrame.frame_index + 1 : undefined;
  const frameCount = Math.max(
    1,
    metadata?.frame_count ??
      timetable?.frame_count ??
      timetableFrameCount ??
      1,
  );
  if (timetable?.source === "ffprobe" && timetable.frames.length > 0) {
    const ptsMs: number[] = [];
    for (const frame of timetable.frames) {
      if (frame.frame_index >= 0) ptsMs[frame.frame_index] = frame.pts_ms;
    }
    return { fps, frameCount, source: "ffprobe", ptsMs };
  }
  return { fps, frameCount, source: "estimated", ptsMs: null };
}

export function frameToTime(frameIndex: number, timebase: FrameTimebase): number {
  const frame = clampFrame(frameIndex, timebase.frameCount);
  const pts = timebase.ptsMs?.[frame];
  if (pts !== undefined && Number.isFinite(pts)) return pts / 1000;
  return frame / timebase.fps;
}

export function timeToFrame(mediaTime: number, timebase: FrameTimebase): number {
  if (!Number.isFinite(mediaTime)) return 0;
  const targetMs = Math.max(0, mediaTime * 1000);
  if (timebase.ptsMs?.length) {
    return clampFrame(findClosestFrame(timebase.ptsMs, targetMs), timebase.frameCount);
  }
  return clampFrame(mediaTime * timebase.fps, timebase.frameCount);
}
