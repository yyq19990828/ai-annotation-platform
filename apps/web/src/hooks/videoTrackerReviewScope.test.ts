import { describe, expect, it } from "vitest";

import type { VideoTrackerJobPreview } from "@/api/videoTracker";
import { projectTrackerReview, referenceReviewInstanceIds } from "./videoTrackerReviewScope";

const preview: VideoTrackerJobPreview = {
  job_id: "job",
  annotation_id: "legacy-source",
  status: "pending_review",
  grid_step: 3,
  output_geometry: "bbox",
  results: [
    ["a", 3],
    ["a", 6],
    ["a", 12],
    ["b", 3],
    ["b", 15],
  ].map(([instanceId, frame]) => ({
    instance_id: String(instanceId),
    frame_index: Number(frame),
    source_annotation_id: `source-${instanceId}`,
    target_annotation_id: `target-${instanceId}`,
    manual_protected: frame === 6,
    geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 },
  })),
};

describe("tracker review projection", () => {
  it("counts only the selected pending rows while remaining links cover real job gaps", () => {
    const result = projectTrackerReview(
      preview,
      {
        instanceIds: ["a"],
        fromFrame: 3,
        toFrame: 6,
        intentRevision: 1,
      },
      4,
    );
    expect(result.selectedResults.map((row) => row.frame_index)).toEqual([3, 6]);
    expect(result.selectedPending).toBe(2);
    expect(result.jobPending).toBe(5);
    expect(result.manualCount).toBe(1);
    expect(result.remainingIntervals).toEqual([
      { fromFrame: 3, toFrame: 6 },
      { fromFrame: 12, toFrame: 15 },
    ]);
    expect(result.preview).toBe(preview);
  });

  it("maps source and target references without guessing from a multi-target legacy source", () => {
    expect(referenceReviewInstanceIds(preview, "source-a")).toEqual(["a"]);
    expect(referenceReviewInstanceIds(preview, "target-b")).toEqual(["b"]);
    expect(referenceReviewInstanceIds(preview, "legacy-source")).toEqual([]);
    expect(referenceReviewInstanceIds(preview, "unrelated")).toEqual([]);
    expect(referenceReviewInstanceIds(preview, null)).toEqual([]);
  });

  it("supports unambiguous legacy single-source candidates only", () => {
    const legacy = {
      ...preview,
      results: [
        {
          ...preview.results[0],
          instance_id: null,
          source_annotation_id: null,
          target_annotation_id: null,
        },
      ],
    };
    expect(referenceReviewInstanceIds(legacy, "legacy-source")).toEqual(["1"]);
    expect(
      referenceReviewInstanceIds(
        { ...legacy, results: [legacy.results[0], { ...legacy.results[0], instance_id: "2" }] },
        "legacy-source",
      ),
    ).toEqual([]);
  });

  it("keeps empty targets or reversed windows empty and invalidates source/task intents", () => {
    const scope = { instanceIds: [], fromFrame: 3, toFrame: 15, intentRevision: 2 };
    const result = projectTrackerReview(preview, scope, 4);
    expect(result.selectedPending).toBe(0);
    expect(
      projectTrackerReview(preview, { ...scope, instanceIds: ["a"], fromFrame: 15, toFrame: 3 }, 4)
        .selectedPending,
    ).toBe(0);
    expect(projectTrackerReview(preview, scope, 5).intentKey).not.toBe(result.intentKey);
    expect(
      projectTrackerReview({ ...preview, expected_source_versions: { "source-a": 2 } }, scope, 4)
        .intentKey,
    ).not.toBe(result.intentKey);
  });
});
