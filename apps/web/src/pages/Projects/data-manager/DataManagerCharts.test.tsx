import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataManagerEntityFacets } from "@/api/taskViews";
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

describe("DataManagerCharts", () => {
  it("renders track facets as accessible chart summaries", () => {
    render(<DataManagerCharts scope="tracks" facets={facets} />);

    expect(screen.getByRole("heading", { name: "轨迹来源" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "轨迹类别" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "质量异常" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /轨迹来源：人工 7，AI 追踪 5/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /质量异常：同帧重复 2，属性不一致 1/ })).toBeInTheDocument();
  });
});
