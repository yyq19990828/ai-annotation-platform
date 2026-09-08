import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVideoBboxNear,
  expectedVideoInterpolation,
  inspectVideoTrack,
  registerVideoTrack,
  verifyVideoKeyframeUpdate,
  type RecordedVideoTrack,
} from "./_video-keyframe-evidence.ts";

function initial(): RecordedVideoTrack {
  return {
    id: "annotation-bus",
    task_id: "video-task",
    class_name: "bus",
    version: 1,
    geometry: {
      type: "video_track_bbox",
      track_id: "track-bus",
      keyframes: [{ frame_index: 0, source: "manual", bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.4 } }],
    },
  };
}

function updated(): RecordedVideoTrack {
  const annotation = initial();
  annotation.version = 2;
  annotation.geometry.keyframes.push({
    frame_index: 8,
    source: "manual",
    bbox: { x: 0.2, y: 0.1, w: 0.3, h: 0.5 },
  });
  return annotation;
}

test("save registration preserves cleanup IDs before later geometry validation fails", () => {
  const saved: Array<[string, string | null]> = [];
  const annotation = {
    ...initial(),
    geometry: { type: "video_bbox", track_id: "unexpected-track" },
  };
  registerVideoTrack(annotation.id, annotation, (id, trackId) => saved.push([id, trackId]));
  assert.throws(() => inspectVideoTrack(annotation, "video-task", "bus", [0]));
  registerVideoTrack("partial-save", { geometry: {} }, (id, trackId) => saved.push([id, trackId]));
  assert.deepEqual(saved, [
    ["annotation-bus", "unexpected-track"],
    ["partial-save", null],
  ]);
});

test("an exact second keyframe keeps the original annotation and track identity", () => {
  const after = updated();
  assert.equal(
    verifyVideoKeyframeUpdate(initial(), after, 8, after.geometry.keyframes[1].bbox),
    after,
  );
});

test("wrong task, class, annotation, track, version or first keyframe cannot pass continuation", () => {
  for (const mutate of [
    (annotation: RecordedVideoTrack) => {
      annotation.task_id = "other-task";
    },
    (annotation: RecordedVideoTrack) => {
      annotation.class_name = "truck";
    },
    (annotation: RecordedVideoTrack) => {
      annotation.id = "other-annotation";
    },
    (annotation: RecordedVideoTrack) => {
      annotation.geometry.track_id = "other-track";
    },
    (annotation: RecordedVideoTrack) => {
      annotation.version = 1;
    },
    (annotation: RecordedVideoTrack) => {
      annotation.geometry.keyframes[0].bbox.x += 0.01;
    },
    (annotation: RecordedVideoTrack) => {
      annotation.geometry.keyframes[1].frame_index = 9;
    },
    (annotation: RecordedVideoTrack) => {
      annotation.geometry.keyframes.push({ ...annotation.geometry.keyframes[1] });
    },
  ]) {
    const after = updated();
    mutate(after);
    assert.throws(() =>
      verifyVideoKeyframeUpdate(initial(), after, 8, updated().geometry.keyframes[1].bbox),
    );
  }
});

test("F4 evidence is the linear midpoint of F0/F8 without adding a stored keyframe", () => {
  const track = updated();
  const midpoint = expectedVideoInterpolation(track, 4);
  assertVideoBboxNear(midpoint, { x: 0.15, y: 0.15, w: 0.25, h: 0.45 }, 1e-12);
  assert.deepEqual(
    track.geometry.keyframes.map((keyframe) => keyframe.frame_index),
    [0, 8],
  );
  assert.throws(() => expectedVideoInterpolation(track, 0));
  assert.throws(() => expectedVideoInterpolation(track, 9));
});

test("invalid and misplaced geometry cannot become video evidence", () => {
  assert.throws(() =>
    assertVideoBboxNear(
      { x: Number.NaN, y: 0.2, w: 0.2, h: 0.4 },
      initial().geometry.keyframes[0].bbox,
    ),
  );
  assert.throws(() =>
    assertVideoBboxNear({ x: 0.6, y: 0.2, w: 0.2, h: 0.4 }, initial().geometry.keyframes[0].bbox),
  );
  const outside = initial();
  outside.geometry.keyframes[0].bbox.w = 0.95;
  assert.throws(() => inspectVideoTrack(outside, "video-task", "bus", [0]));
  const hidden = initial();
  hidden.geometry.outside = [{ from: 0, to: 8 }];
  assert.throws(() => inspectVideoTrack(hidden, "video-task", "bus", [0]));
});
