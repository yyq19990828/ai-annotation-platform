import { describe, expect, it } from "vitest";
import { buildVideoFrameBuckets, videoFrameBucketMarkers, videoTimelineMarkers } from "./videoFrameBuckets";
import type { VideoTrackGeometry } from "@/types";

describe("videoFrameBuckets", () => {
  it("builds stable per-frame track buckets", () => {
    const tracks: VideoTrackGeometry[] = [
      {
        type: "video_track",
        track_id: "trk_b",
        keyframes: [
          { frame_index: 10, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "manual" },
          { frame_index: 20, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "prediction" },
        ],
      },
      {
        type: "video_track",
        track_id: "trk_a",
        keyframes: [
          { frame_index: 10, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "manual", absent: true },
        ],
      },
    ];

    const markers = videoFrameBucketMarkers(buildVideoFrameBuckets(tracks));

    expect(markers).toEqual([
      {
        frame: 10,
        trackIds: ["trk_a", "trk_b"],
        hasManual: true,
        hasPrediction: false,
        hasAbsent: true,
        density: 2,
      },
      {
        frame: 20,
        trackIds: ["trk_b"],
        hasManual: false,
        hasPrediction: true,
        hasAbsent: false,
        density: 1,
      },
    ]);
  });

  it("uses the last keyframe when a track repeats a frame", () => {
    const tracks: VideoTrackGeometry[] = [{
      type: "video_track",
      track_id: "trk",
      keyframes: [
        { frame_index: 1, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "prediction" },
        { frame_index: 1, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "manual", absent: true },
      ],
    }];

    expect(videoFrameBucketMarkers(buildVideoFrameBuckets(tracks))[0]).toMatchObject({
      frame: 1,
      hasManual: true,
      hasPrediction: false,
      hasAbsent: true,
    });
  });

  it("emits outside timeline segments separately from keyframe density", () => {
    const tracks: VideoTrackGeometry[] = [{
      type: "video_track",
      track_id: "trk",
      outside: [{ from: 3, to: 5 }],
      keyframes: [
        { frame_index: 1, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "manual" },
        { frame_index: 7, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, source: "prediction" },
      ],
    }];

    expect(videoTimelineMarkers(tracks)).toEqual([
      {
        type: "keyframe",
        frame: 1,
        trackIds: ["trk"],
        hasManual: true,
        hasPrediction: false,
        hasAbsent: false,
        density: 1,
      },
      {
        type: "outside",
        from: 3,
        to: 5,
        trackIds: ["trk"],
        hasPrediction: false,
      },
      {
        type: "keyframe",
        frame: 7,
        trackIds: ["trk"],
        hasManual: false,
        hasPrediction: true,
        hasAbsent: false,
        density: 1,
      },
    ]);
  });
});
