import { describe, expect, it } from "vitest";
import type {
  AnnotationResponse,
  VideoTrackKeyframe,
  VideoTrackMaskGeometry,
  VideoTrackMaskKeyframe,
  VideoTrackOutsideRange,
} from "@/types";
import {
  deriveVideoTrackContext,
  type VideoContextTrackAnnotation,
  type VideoContextTrackGeometry,
} from "./videoTrackContext";
import {
  isAnyVideoTrack,
  resolveTrackAtFrame,
  resolveVideoMaskTrackAtFrame,
  resolveVideoPolygonTrackAtFrame,
  resolveVideoPolylineTrackAtFrame,
} from "./videoStageGeometry";
import { visibleKeyframesForTimeline } from "./videoTrackTimeline";

type VectorTrack = Exclude<VideoContextTrackGeometry, VideoTrackMaskGeometry>;
type FrameInput = Pick<VideoTrackKeyframe, "frame_index" | "source" | "occluded">;
type MaskFrameInput = Pick<VideoTrackMaskKeyframe, "frame_index" | "source" | "occluded">;

const vectorTypes = ["video_track_bbox", "video_track_polygon", "video_track_polyline"] as const;
const defaultFrames: MaskFrameInput[] = [
  { frame_index: 0, source: "manual" },
  { frame_index: 10, source: "prediction", occluded: true },
  { frame_index: 20, source: "manual" },
];

function vectorTrack(
  type: VectorTrack["type"],
  frames: FrameInput[] = defaultFrames,
  outside?: VideoTrackOutsideRange[],
): VectorTrack {
  const common = { track_id: type, outside };
  if (type === "video_track_bbox") {
    return {
      ...common,
      type,
      keyframes: frames.map((frame) => ({ ...frame, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 } })),
    };
  }
  return {
    ...common,
    type,
    keyframes: frames.map((frame) => ({
      ...frame,
      points: [
        [0, 0],
        [0.2, 0],
        [0.2, 0.2],
      ],
    })),
  };
}

function maskTrack(
  frames: MaskFrameInput[] = defaultFrames,
  outside?: VideoTrackOutsideRange[],
): VideoTrackMaskGeometry {
  return {
    type: "video_track_mask",
    track_id: "mask",
    outside,
    keyframes: frames.map((frame) => ({
      ...frame,
      mask: {
        encoding: "coco_rle_ref",
        size: [2, 2],
        object_key: `mask-${frame.frame_index}`,
        sha256: "a".repeat(64),
        runs: 1,
        bytes: 1,
      },
    })),
  };
}

function resolveVector(track: VectorTrack, frameIndex: number) {
  return track.type === "video_track_bbox"
    ? resolveTrackAtFrame(track, frameIndex)
    : track.type === "video_track_polygon"
      ? resolveVideoPolygonTrackAtFrame(track, frameIndex)
      : resolveVideoPolylineTrackAtFrame(track, frameIndex);
}

describe.each(vectorTypes)("deriveVideoTrackContext: %s", (type) => {
  it("reports exact raw prediction, occlusion and strict neighboring frames", () => {
    expect(deriveVideoTrackContext(vectorTrack(type), 10)).toEqual({
      state: "keyframe",
      source: "prediction",
      sourceFrame: 10,
      occluded: true,
      previousFrame: 0,
      nextFrame: 20,
    });
  });

  it("keeps a recorded interpolated source separate from exact-keyframe state", () => {
    const track = vectorTrack(type, [{ frame_index: 10, source: "interpolated" }]);
    expect(resolveVector(track, 10)?.source).toBe("manual");
    expect(deriveVideoTrackContext(track, 10)).toMatchObject({
      state: "keyframe",
      source: "interpolated",
      sourceFrame: 10,
    });
  });

  it("does not infer interpolation provenance or propagate endpoint occlusion", () => {
    const track = vectorTrack(type, [
      { frame_index: 0, source: "prediction", occluded: true },
      { frame_index: 10, source: "prediction", occluded: true },
    ]);
    expect(resolveVector(track, 5)?.source).toBe("interpolated");
    expect(deriveVideoTrackContext(track, 5)).toEqual({
      state: "interpolated",
      source: "unknown",
      sourceFrame: null,
      occluded: false,
      previousFrame: 0,
      nextFrame: 10,
    });
  });

  it.each([0, 20])("reports unavailable outside the keyframe range at F%s", (frame) => {
    const track = vectorTrack(type, [{ frame_index: 10, source: "manual" }]);
    expect(resolveVector(track, frame)).toBeNull();
    expect(deriveVideoTrackContext(track, frame)).toMatchObject({
      state: "unavailable",
      source: "unknown",
      sourceFrame: null,
      occluded: false,
    });
  });

  it("distinguishes outside from unavailable interpolation across an outside gap", () => {
    const track = vectorTrack(type, defaultFrames, [{ from: 4, to: 6 }]);
    expect(deriveVideoTrackContext(track, 5).state).toBe("outside");
    for (const frame of [3, 7]) {
      expect(resolveVector(track, frame)).toBeNull();
      expect(deriveVideoTrackContext(track, frame).state).toBe("unavailable");
    }
    expect(deriveVideoTrackContext(track, 10).state).toBe("keyframe");
  });

  it("uses the resolver's first duplicate for metadata without changing timeline deduplication", () => {
    const track = vectorTrack(type, [
      defaultFrames[1],
      defaultFrames[0],
      { frame_index: 10, source: "manual", occluded: false },
      defaultFrames[2],
    ]);
    const before = structuredClone(track);
    expect(resolveVector(track, 10)).toMatchObject({ source: "prediction", occluded: true });
    expect(deriveVideoTrackContext(track, 10)).toMatchObject({
      state: "keyframe",
      source: "prediction",
      occluded: true,
      previousFrame: 0,
      nextFrame: 20,
    });
    expect(visibleKeyframesForTimeline(track)[1].source).toBe("manual");
    expect(track).toEqual(before);
  });
});

describe.each([...vectorTypes, "video_track_mask"] as const)("shared track context: %s", (type) => {
  const make = (frames: MaskFrameInput[] = defaultFrames, outside?: VideoTrackOutsideRange[]) =>
    type === "video_track_mask" ? maskTrack(frames, outside) : vectorTrack(type, frames, outside);

  it("preserves recorded metadata while outside takes precedence and hides occlusion", () => {
    const track = make(defaultFrames, [{ from: 10, to: 10, source: "manual" }]);
    expect(deriveVideoTrackContext(track, 10)).toEqual({
      state: "outside",
      source: "prediction",
      sourceFrame: 10,
      occluded: false,
      previousFrame: 0,
      nextFrame: 20,
    });
  });

  it("does not infer keyframe provenance from the outside range source", () => {
    const context = deriveVideoTrackContext(make(defaultFrames, [{ from: 4, to: 6 }]), 5);
    expect(context).toMatchObject({ state: "outside", source: "unknown", sourceFrame: null });
  });

  it.each([undefined, null, "ai"])("marks unrecorded or invalid source %s as unknown", (source) => {
    const track = make();
    if (source === undefined) Reflect.deleteProperty(track.keyframes[1], "source");
    else Reflect.set(track.keyframes[1], "source", source);
    expect(deriveVideoTrackContext(track, 10)).toMatchObject({
      state: "keyframe",
      source: "unknown",
      sourceFrame: 10,
    });
  });

  it("keeps empty tracks unavailable unless the current frame is explicitly outside", () => {
    expect(deriveVideoTrackContext(make([]), 5)).toEqual({
      state: "unavailable",
      source: "unknown",
      sourceFrame: null,
      occluded: false,
      previousFrame: null,
      nextFrame: null,
    });
    expect(deriveVideoTrackContext(make([], [{ from: 4, to: 6 }]), 5).state).toBe("outside");
  });
});

describe("nearest visible Mask context", () => {
  it("holds the nearest future keyframe and its actual source and occlusion", () => {
    expect(deriveVideoTrackContext(maskTrack(), 7)).toEqual({
      state: "held",
      source: "prediction",
      sourceFrame: 10,
      occluded: true,
      previousFrame: 0,
      nextFrame: 10,
    });
  });

  it("resolves ties to the earlier frame even when the future keyframe is stored first", () => {
    const track = maskTrack([defaultFrames[1], defaultFrames[0]]);
    expect(resolveVideoMaskTrackAtFrame(track, 5)?.keyframeFrame).toBe(0);
    expect(deriveVideoTrackContext(track, 5)).toMatchObject({
      state: "held",
      source: "manual",
      sourceFrame: 0,
      occluded: false,
    });
  });

  it.each([
    [0, 10],
    [30, 20],
  ])("holds at F%s beyond the keyframe range from F%s", (frame, sourceFrame) => {
    const track = maskTrack(defaultFrames.slice(1));
    expect(deriveVideoTrackContext(track, frame)).toMatchObject({ state: "held", sourceFrame });
  });

  it("excludes outside keyframes but retains nearest holding across an outside gap", () => {
    const track = maskTrack(defaultFrames, [{ from: 10, to: 10 }]);
    expect(deriveVideoTrackContext(track, 9)).toMatchObject({ state: "held", sourceFrame: 0 });
    expect(deriveVideoTrackContext(track, 12)).toMatchObject({ state: "held", sourceFrame: 20 });
    expect(deriveVideoTrackContext(track, 10).state).toBe("outside");
    expect(
      deriveVideoTrackContext(maskTrack(defaultFrames, [{ from: 4, to: 6 }]), 7),
    ).toMatchObject({ state: "held", sourceFrame: 10 });
  });

  it("has no available geometry when every keyframe is outside", () => {
    const track = maskTrack([{ frame_index: 10, source: "manual" }], [{ from: 10, to: 10 }]);
    expect(deriveVideoTrackContext(track, 5)).toMatchObject({
      state: "unavailable",
      source: "unknown",
      sourceFrame: null,
      previousFrame: null,
      nextFrame: null,
    });
  });

  it("keeps the resolver's first duplicate as the holding anchor", () => {
    const track = maskTrack([
      defaultFrames[1],
      defaultFrames[0],
      { frame_index: 10, source: "manual", occluded: false },
    ]);
    const before = structuredClone(track);
    expect(resolveVideoMaskTrackAtFrame(track, 9)).toMatchObject({
      keyframeFrame: 10,
      source: "prediction",
      occluded: true,
    });
    expect(deriveVideoTrackContext(track, 9)).toMatchObject({
      state: "held",
      source: "prediction",
      sourceFrame: 10,
      occluded: true,
    });
    expect(visibleKeyframesForTimeline(track)[1].source).toBe("manual");
    expect(track).toEqual(before);
  });

  it("keeps the actual holding frame when its source is missing", () => {
    const track = maskTrack();
    Reflect.deleteProperty(track.keyframes[1], "source");
    expect(deriveVideoTrackContext(track, 7)).toMatchObject({
      state: "held",
      source: "unknown",
      sourceFrame: 10,
    });
  });
});

it("narrows all four track annotation geometries without admitting single-frame annotations", () => {
  const geometries = [
    ...vectorTypes.map((type) => vectorTrack(type)),
    maskTrack(),
    { type: "video_bbox", frame_index: 0, x: 0, y: 0, w: 0.2, h: 0.2 },
  ];
  const annotations = geometries.map((geometry) => ({ geometry }) as AnnotationResponse);
  const tracks: VideoContextTrackAnnotation[] = annotations.filter(isAnyVideoTrack);
  expect(tracks.map((annotation) => annotation.geometry.type)).toEqual([
    ...vectorTypes,
    "video_track_mask",
  ]);
});
