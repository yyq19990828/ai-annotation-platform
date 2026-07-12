import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { DataManagerFilterField, DataManagerSummary, ProjectTaskView } from "@/api/taskViews";
import { buildFilterJson, editableRulesFromView } from "./ProjectDataManagerPage";
import { DataManagerOverview } from "./data-manager/DataManagerOverview";

function view(filterJson: Record<string, unknown>): ProjectTaskView {
  return {
    id: null,
    key: "all",
    project_id: "project-id",
    owner_id: null,
    name: "全部任务",
    visibility: "project",
    entity_scope: "tasks",
    filter_json: filterJson,
    sort_json: [],
    columns_json: [],
    builtin: true,
    task_count: 12,
    result_count: 12,
    created_at: null,
    updated_at: null,
    invalid_fields: [],
  };
}

describe("editableRulesFromView", () => {
  it("keeps the built-in all view unfiltered", () => {
    expect(editableRulesFromView(view({}))).toEqual([]);
  });

  it("restores saved flat rules", () => {
    expect(
      editableRulesFromView(
        view({
          op: "and",
          rules: [{ field: "task.status", op: "in", value: ["pending", "review"] }],
        }),
      ),
    ).toEqual([{ field: "task.status", op: "in", value: "pending, review" }]);
  });
});

describe("buildFilterJson", () => {
  const numberField: DataManagerFilterField = {
    key: "annotation.annotation_count",
    label: "标注数",
    group: "标注",
    value_type: "number",
    operators: ["in"],
    options: [],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  };

  it("keeps keyword and converts numeric list items", () => {
    expect(
      buildFilterJson(
        [{ field: numberField.key, op: "in", value: "1, 2, bad" }],
        [numberField],
        "frame-42",
      ),
    ).toEqual({
      op: "and",
      rules: [
        { field: "task.keyword", op: "contains", value: "frame-42" },
        { field: numberField.key, op: "in", value: [1, 2] },
      ],
    });
  });
});

describe("DataManagerOverview", () => {
  it("shows the matched scope and schema-driven attribute aggregation", () => {
    const summary: DataManagerSummary = {
      scope: { visible_task_total: 12, matched_task_total: 3 },
      task_status: { pending: 2, review: 1 },
      annotations: {
        total: 8,
        single_frame: 6,
        tracked: 2,
        distinct_tracks: 1,
        imported: 0,
        by_source: { manual: 5, prediction_based: 3 },
        by_class: { car: 8 },
        by_tool_unit: { bbox: 8 },
        by_type: { bbox: 8 },
      },
      ai_review: {
        prediction_shapes: 2,
        low_confidence_prediction_shapes: 1,
        tracker_jobs: 1,
        confidence_threshold: 0.5,
        by_model_version: { "detector-v2": 2 },
        confidence_buckets: { "025_049": 1, gte_075: 1 },
      },
      unresolved_feedback: 1,
      attributes: [{
        tool_unit_id: "bbox",
        key: "color",
        label: "颜色",
        eligible: 8,
        present: 6,
        missing: 2,
        values: { red: 4, blue: 2 },
      }],
      kind_metrics: { images_with_dimensions: 3 },
    };

    render(<DataManagerOverview summary={summary} isLoading={false} />);

    expect(screen.getByText("当前匹配")).toBeInTheDocument();
    expect(screen.getByText("可见 12")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "任务状态" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "标注来源" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "标注类别" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "待审模型版本" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "待审置信度" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /任务状态：待标注 2，待审核 1/ })).toBeInTheDocument();
    expect(screen.getByText("低置信 1")).toBeInTheDocument();
    // 「颜色」既出现在属性完整度行，也作为属性值分布图标题，故用 getAllByText；6/8 唯一属于完整度。
    expect(screen.getAllByText("颜色").length).toBeGreaterThan(0);
    expect(screen.getByText("6/8")).toBeInTheDocument();
  });
});
