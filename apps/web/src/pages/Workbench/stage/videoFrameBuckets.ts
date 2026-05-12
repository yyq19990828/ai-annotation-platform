import type { VideoTrackGeometry } from "@/types";

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
