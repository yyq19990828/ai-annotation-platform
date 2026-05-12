import type { VideoTrackGeometry, VideoTrackOutsideRange } from "@/types";

type OutsideInput = Partial<VideoTrackOutsideRange> | null | undefined;

function normalizeFrame(value: unknown) {
  const frame = Number(value);
  if (!Number.isFinite(frame)) return null;
  return Math.max(0, Math.floor(frame));
}

function cleanRange(range: OutsideInput): VideoTrackOutsideRange | null {
  if (!range) return null;
  const from = normalizeFrame(range.from);
  const to = normalizeFrame(range.to);
  if (from === null || to === null) return null;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return {
    from: start,
    to: end,
    source: range.source === "prediction" ? "prediction" : "manual",
  };
}

export function normalizeOutsideRanges(ranges: readonly OutsideInput[] | undefined): VideoTrackOutsideRange[] {
  const cleaned = (ranges ?? [])
    .map(cleanRange)
    .filter((range): range is VideoTrackOutsideRange => Boolean(range))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const merged: VideoTrackOutsideRange[] = [];
  for (const range of cleaned) {
    const prev = merged[merged.length - 1];
    if (prev && range.from <= prev.to + 1) {
      prev.to = Math.max(prev.to, range.to);
      if (range.source === "prediction") prev.source = "prediction";
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function legacyAbsentRanges(track: VideoTrackGeometry): VideoTrackOutsideRange[] {
  return normalizeOutsideRanges(
    track.keyframes
      .filter((keyframe) => keyframe.absent)
      .map((keyframe) => ({
        from: keyframe.frame_index,
        to: keyframe.frame_index,
        source: keyframe.source === "prediction" ? "prediction" : "manual",
      })),
  );
}

export function effectiveOutsideRanges(track: VideoTrackGeometry): VideoTrackOutsideRange[] {
  return normalizeOutsideRanges([...(track.outside ?? []), ...legacyAbsentRanges(track)]);
}

export function isFrameInOutsideRanges(ranges: readonly VideoTrackOutsideRange[], frameIndex: number) {
  return ranges.some((range) => frameIndex >= range.from && frameIndex <= range.to);
}

export function isFrameOutside(track: VideoTrackGeometry, frameIndex: number) {
  return isFrameInOutsideRanges(effectiveOutsideRanges(track), frameIndex);
}

export function outsideRangesIntersect(
  ranges: readonly VideoTrackOutsideRange[],
  fromFrame: number,
  toFrame: number,
) {
  const from = Math.min(fromFrame, toFrame);
  const to = Math.max(fromFrame, toFrame);
  return ranges.some((range) => range.from <= to && range.to >= from);
}

export function addOutsideRange(
  track: VideoTrackGeometry,
  range: VideoTrackOutsideRange,
): VideoTrackGeometry {
  return {
    ...track,
    outside: normalizeOutsideRanges([...(track.outside ?? []), range]),
  };
}

export function removeOutsideFrame(track: VideoTrackGeometry, frameIndex: number): VideoTrackGeometry {
  const frame = Math.max(0, Math.floor(frameIndex));
  const next: VideoTrackOutsideRange[] = [];

  for (const range of normalizeOutsideRanges(track.outside ?? [])) {
    if (frame < range.from || frame > range.to) {
      next.push(range);
      continue;
    }
    if (range.from < frame) next.push({ ...range, to: frame - 1 });
    if (frame < range.to) next.push({ ...range, from: frame + 1 });
  }

  return {
    ...track,
    outside: normalizeOutsideRanges(next),
  };
}
