import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataManagerEntityFacets, DataManagerSummary } from "@/api/taskViews";
import { DataManagerCharts } from "./DataManagerCharts";

const facets: DataManagerEntityFacets = {
  matched_total: 12,
  task_total: 4,
  by_class: { car: 8, person: 4 },
  by_source: { manual: 7, ai_tracker: 5 },
  by_tool_unit: { bbox: 12 },
  by_type: { video_track_bbox: 12 },
  by_quality: { duplicate_frame: 2, inconsistent_attributes: 1 },
};

const summary: DataManagerSummary = {
  scope: { visible_task_total: 3, matched_task_total: 2 },
  task_status: { review: 2 },
  annotations: {
    total: 2,
    single_frame: 2,
    tracked: 0,
    distinct_tracks: 0,
    imported: 0,
    by_source: { manual: 2 },
    by_class: { car: 2 },
    by_tool_unit: { bbox: 2 },
    by_type: { bbox: 2 },
  },
  ai_review: {
    prediction_shapes: 5,
    low_confidence_prediction_shapes: 3,
    tracker_jobs: 0,
    confidence_threshold: 0.5,
    by_model_version: { "detector-v2": 5 },
    confidence_buckets: { "025_049": 3, gte_075: 2 },
  },
  unresolved_feedback: 0,
  attributes: [],
  kind_metrics: {},
};

describe("DataManagerCharts", () => {
  it("renders track facets as accessible chart summaries", () => {
    render(<DataManagerCharts scope="tracks" facets={facets} />);

    expect(screen.getByRole("heading", { name: "轨迹来源" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "轨迹类别" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "质量异常" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /轨迹来源：人工 7，AI 追踪 5/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /质量异常：同帧重复 2，属性不一致 1/ })).toBeInTheDocument();
  });

  it("renders pending model and candidate confidence distributions for tasks", () => {
    render(<DataManagerCharts scope="tasks" summary={summary} />);

    expect(screen.getByRole("img", { name: "待审模型版本：detector-v2 5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "待审置信度：25–49% 3，75–100% 2" })).toBeInTheDocument();
  });
});
