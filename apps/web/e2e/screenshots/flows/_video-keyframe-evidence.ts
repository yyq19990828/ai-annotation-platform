import assert from "node:assert/strict";

export interface VideoRecordingBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecordedVideoTrack {
  id: string;
  task_id: string;
  class_name: string;
  version: number;
  geometry: {
    type: "video_track_bbox";
    track_id: string;
    keyframes: Array<{ frame_index: number; bbox: VideoRecordingBbox; source: "manual" }>;
    outside?: unknown[];
  };
}

export type VideoTrackCreated = (annotationId: string, trackId: string | null) => void;

/** Register the persisted annotation even if its geometry is invalid and later checks fail. */
export function registerVideoTrack(
  id: string,
  annotation: Record<string, unknown>,
  onCreated: VideoTrackCreated,
): void {
  const geometry = annotation.geometry as { track_id?: unknown } | undefined;
  const trackId = geometry?.track_id ?? annotation.track_id;
  onCreated(id, typeof trackId === "string" ? trackId : null);
}

export function inspectVideoTrack(
  value: unknown,
  taskId: string,
  label: string,
  frames: number[],
): RecordedVideoTrack {
  const annotation = value as RecordedVideoTrack;
  assert.ok(annotation && typeof annotation.id === "string" && annotation.id.length > 0);
  assert.equal(annotation.task_id, taskId);
  assert.equal(annotation.class_name, label);
  assert.ok(Number.isInteger(annotation.version) && annotation.version > 0);
  assert.equal(annotation.geometry?.type, "video_track_bbox");
  assert.ok(
    typeof annotation.geometry.track_id === "string" && annotation.geometry.track_id.length > 0,
  );
  assert.deepEqual(
    annotation.geometry.keyframes.map((keyframe) => keyframe.frame_index),
    frames,
  );
  assert.ok(!annotation.geometry.outside?.length, "The demonstrated track must remain visible");
  for (const keyframe of annotation.geometry.keyframes) {
    assert.equal(keyframe.source, "manual");
    const { x, y, w, h } = keyframe.bbox;
    assert.ok(
      [x, y, w, h].every((number) => Number.isFinite(number) && number >= 0 && number <= 1),
    );
    assert.ok(w > 0 && h > 0 && x + w <= 1 + 1e-8 && y + h <= 1 + 1e-8);
  }
  return annotation;
}

export function anchorVideoBbox(
  anchor: readonly [number, number, number, number],
): VideoRecordingBbox {
  return { x: anchor[0], y: anchor[1], w: anchor[2] - anchor[0], h: anchor[3] - anchor[1] };
}

export function assertVideoBboxNear(
  actual: VideoRecordingBbox,
  expected: VideoRecordingBbox,
  tolerance = 0.005,
): void {
  for (const key of ["x", "y", "w", "h"] as const) {
    assert.ok(
      Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) <= tolerance,
      `Video bbox ${key}: expected ${expected[key]}, received ${actual[key]}`,
    );
  }
}

export function verifyVideoKeyframeUpdate(
  before: RecordedVideoTrack,
  value: unknown,
  frame: number,
  bbox: VideoRecordingBbox,
): RecordedVideoTrack {
  const frames = [...before.geometry.keyframes.map((keyframe) => keyframe.frame_index), frame].sort(
    (a, b) => a - b,
  );
  assert.equal(new Set(frames).size, frames.length, "The demonstration must add a new keyframe");
  const after = inspectVideoTrack(value, before.task_id, before.class_name, frames);
  assert.equal(after.id, before.id, "A keyframe edit must retain the annotation ID");
  assert.equal(
    after.geometry.track_id,
    before.geometry.track_id,
    "A keyframe edit must retain the track ID",
  );
  assert.ok(after.version > before.version, "The persisted annotation version must advance");
  for (const original of before.geometry.keyframes) {
    assert.deepEqual(
      after.geometry.keyframes.find((keyframe) => keyframe.frame_index === original.frame_index),
      original,
    );
  }
  assertVideoBboxNear(
    after.geometry.keyframes.find((keyframe) => keyframe.frame_index === frame)!.bbox,
    bbox,
  );
  return after;
}

export function expectedVideoInterpolation(
  track: RecordedVideoTrack,
  frame: number,
): VideoRecordingBbox {
  const before = track.geometry.keyframes.filter((keyframe) => keyframe.frame_index < frame).at(-1);
  const after = track.geometry.keyframes.find((keyframe) => keyframe.frame_index > frame);
  assert.ok(before && after, "An interpolation sample must lie strictly between saved keyframes");
  const ratio = (frame - before.frame_index) / (after.frame_index - before.frame_index);
  const interpolate = (key: keyof VideoRecordingBbox) =>
    before.bbox[key] + (after.bbox[key] - before.bbox[key]) * ratio;
  return { x: interpolate("x"), y: interpolate("y"), w: interpolate("w"), h: interpolate("h") };
}
