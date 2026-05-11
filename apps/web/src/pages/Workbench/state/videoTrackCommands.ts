import type { VideoTrackGeometry, VideoTrackKeyframe } from "@/types";
import type { Command } from "./useAnnotationHistory";

function cloneKeyframe(kf: VideoTrackKeyframe): VideoTrackKeyframe {
  return {
    frame_index: kf.frame_index,
    bbox: { ...kf.bbox },
    source: kf.source,
    absent: kf.absent,
    occluded: kf.occluded,
  };
}

function sameKeyframe(a: VideoTrackKeyframe | undefined, b: VideoTrackKeyframe | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.frame_index === b.frame_index &&
    a.source === b.source &&
    (a.absent ?? false) === (b.absent ?? false) &&
    (a.occluded ?? false) === (b.occluded ?? false) &&
    a.bbox.x === b.bbox.x &&
    a.bbox.y === b.bbox.y &&
    a.bbox.w === b.bbox.w &&
    a.bbox.h === b.bbox.h
  );
}

export function buildVideoKeyframeCommand(
  annotationId: string,
  before: VideoTrackGeometry,
  after: VideoTrackGeometry,
): Extract<Command, { kind: "videoKeyframe" }> | null {
  if (before.type !== "video_track" || after.type !== "video_track") return null;
  if (before.track_id !== after.track_id) return null;

  const frames = new Set<number>();
  before.keyframes.forEach((kf) => frames.add(kf.frame_index));
  after.keyframes.forEach((kf) => frames.add(kf.frame_index));

  const changed: Array<{
    frameIndex: number;
    before: VideoTrackKeyframe | null;
    after: VideoTrackKeyframe | null;
  }> = [];

  for (const frameIndex of frames) {
    const beforeKf = before.keyframes.find((kf) => kf.frame_index === frameIndex);
    const afterKf = after.keyframes.find((kf) => kf.frame_index === frameIndex);
    if (!sameKeyframe(beforeKf, afterKf)) {
      changed.push({
        frameIndex,
        before: beforeKf ? cloneKeyframe(beforeKf) : null,
        after: afterKf ? cloneKeyframe(afterKf) : null,
      });
    }
  }

  if (changed.length !== 1) return null;
  const only = changed[0];
  return {
    kind: "videoKeyframe",
    annotationId,
    frameIndex: only.frameIndex,
    before: only.before,
    after: only.after,
  };
}

export function applyVideoKeyframeToGeometry(
  geometry: VideoTrackGeometry,
  frameIndex: number,
  keyframe: VideoTrackKeyframe | null,
): VideoTrackGeometry {
  const keyframes = geometry.keyframes.filter((kf) => kf.frame_index !== frameIndex);
  if (keyframe) keyframes.push(cloneKeyframe(keyframe));
  keyframes.sort((a, b) => a.frame_index - b.frame_index);
  return { ...geometry, keyframes };
}
