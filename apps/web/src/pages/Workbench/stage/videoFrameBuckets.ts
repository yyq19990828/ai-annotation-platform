import type { VideoTrackGeometry } from "@/types";
import { effectiveOutsideRanges } from "./videoTrackOutside";

export interface VideoFrameBucket {
  frame: number;
  trackIds: string[];
  hasManual: boolean;
  hasPrediction: boolean;
  hasAbsent: boolean;
}

export type VideoFrameBucketMarker = VideoFrameBucket & {
  density: number;
};

export type VideoTimelineMarker =
  | {
    type: "keyframe";
    frame: number;
    trackIds: string[];
    hasManual: boolean;
    hasPrediction: boolean;
    hasAbsent: boolean;
    density: number;
  }
  | {
    type: "outside";
    from: number;
    to: number;
    trackIds: string[];
    hasPrediction: boolean;
  };

function ensureBucket(buckets: Map<number, VideoFrameBucket>, frame: number) {
  let bucket = buckets.get(frame);
  if (!bucket) {
    bucket = {
      frame,
      trackIds: [],
      hasManual: false,
      hasPrediction: false,
      hasAbsent: false,
    };
    buckets.set(frame, bucket);
  }
  return bucket;
}

export function buildVideoFrameBuckets(tracks: readonly VideoTrackGeometry[]): Map<number, VideoFrameBucket> {
  const buckets = new Map<number, VideoFrameBucket>();

  for (const track of tracks) {
    const latestByFrame = new Map<number, (typeof track.keyframes)[number]>();
    for (const keyframe of track.keyframes) {
      latestByFrame.set(keyframe.frame_index, keyframe);
    }

    for (const keyframe of latestByFrame.values()) {
      const bucket = ensureBucket(buckets, keyframe.frame_index);
      if (!bucket.trackIds.includes(track.track_id)) bucket.trackIds.push(track.track_id);
      if (keyframe.absent) bucket.hasAbsent = true;
      if (keyframe.source === "prediction") bucket.hasPrediction = true;
      else bucket.hasManual = true;
    }
  }

  for (const bucket of buckets.values()) {
    bucket.trackIds.sort((a, b) => a.localeCompare(b));
  }

  return buckets;
}

export function videoFrameBucketMarkers(buckets: Map<number, VideoFrameBucket>): VideoFrameBucketMarker[] {
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      trackIds: [...bucket.trackIds],
      density: bucket.trackIds.length,
    }))
    .sort((a, b) => a.frame - b.frame);
}

function ensureOutsideMarker(
  markers: Map<string, Extract<VideoTimelineMarker, { type: "outside" }>>,
  from: number,
  to: number,
) {
  const key = `${from}:${to}`;
  let marker = markers.get(key);
  if (!marker) {
    marker = { type: "outside", from, to, trackIds: [], hasPrediction: false };
    markers.set(key, marker);
  }
  return marker;
}

export function videoTimelineMarkers(tracks: readonly VideoTrackGeometry[]): VideoTimelineMarker[] {
  const keyframeMarkers = videoFrameBucketMarkers(buildVideoFrameBuckets(tracks)).map((bucket) => ({
    type: "keyframe" as const,
    frame: bucket.frame,
    trackIds: bucket.trackIds,
    hasManual: bucket.hasManual,
    hasPrediction: bucket.hasPrediction,
    hasAbsent: bucket.hasAbsent,
    density: bucket.density,
  }));
  const outsideMarkers = new Map<string, Extract<VideoTimelineMarker, { type: "outside" }>>();

  for (const track of tracks) {
    for (const range of effectiveOutsideRanges(track)) {
      const marker = ensureOutsideMarker(outsideMarkers, range.from, range.to);
      if (!marker.trackIds.includes(track.track_id)) marker.trackIds.push(track.track_id);
      if (range.source === "prediction") marker.hasPrediction = true;
    }
  }

  return [
    ...keyframeMarkers,
    ...[...outsideMarkers.values()].map((marker) => ({
      ...marker,
      trackIds: [...marker.trackIds].sort((a, b) => a.localeCompare(b)),
    })),
  ].sort((a, b) => {
    const aFrame = a.type === "keyframe" ? a.frame : a.from;
    const bFrame = b.type === "keyframe" ? b.frame : b.from;
    if (aFrame !== bFrame) return aFrame - bFrame;
    return a.type.localeCompare(b.type);
  });
}
