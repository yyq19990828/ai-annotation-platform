import { describe, expect, it } from "vitest";
import type { AttributeSchema } from "@/api/projects";
import type { AnnotationResponse } from "@/types";
import {
  DEFAULT_ATTRIBUTE_MODE,
  applyAttributeModeValue,
  attributeModeFields,
  canApplyAttributeModeToAnnotation,
  normalizeAttributeModeState,
} from "./attributeMode";

const schema: AttributeSchema = {
  fields: [
    { key: "note", label: "备注", type: "text" },
    { key: "occluded", label: "遮挡", type: "boolean" },
    {
      key: "state",
      label: "状态",
      type: "select",
      options: [
        { value: "open", label: "开放" },
        { value: "closed", label: "关闭" },
      ],
    },
  ],
};

function annotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return {
    id: "ann",
    task_id: "task",
    project_id: "project",
    user_id: "user",
    source: "manual",
    annotation_type: "bbox",
    class_name: "car",
    geometry: { type: "bbox", x: 0, y: 0, w: 0.1, h: 0.1 },
    confidence: 1,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    attributes: {},
    created_at: "2026-06-07T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

describe("attribute mode helpers", () => {
  it("filters to boolean/select/multiselect fields", () => {
    expect(attributeModeFields(schema).map((field) => field.key)).toEqual(["occluded", "state"]);
  });

  it("normalizes empty mode to the first supported field with a default value", () => {
    expect(normalizeAttributeModeState(DEFAULT_ATTRIBUTE_MODE, schema)).toEqual({
      enabled: false,
      fieldKey: "occluded",
      currentValue: true,
    });
  });

  it("preserves current value when field remains available", () => {
    expect(normalizeAttributeModeState({
      enabled: true,
      fieldKey: "state",
      currentValue: "closed",
    }, schema)).toEqual({
      enabled: true,
      fieldKey: "state",
      currentValue: "closed",
    });
  });

  it("limits apply targets to supported 2D geometry and matching classes", () => {
    const field = { key: "occluded", label: "遮挡", type: "boolean" as const, applies_to: ["car"] };
    expect(canApplyAttributeModeToAnnotation(annotation(), field)).toBe(true);
    expect(canApplyAttributeModeToAnnotation(annotation({ class_name: "person" }), field)).toBe(false);
    expect(canApplyAttributeModeToAnnotation(
      annotation({ annotation_type: "polyline", geometry: { type: "polyline", points: [[0, 0], [1, 1]] } }),
      field,
    )).toBe(false);
  });

  it("builds attribute patches for boolean and multiselect values", () => {
    expect(applyAttributeModeValue({ keep: "yes" }, {
      key: "occluded",
      label: "遮挡",
      type: "boolean",
    }, true)).toEqual({ keep: "yes", occluded: true });
    expect(applyAttributeModeValue(undefined, {
      key: "tags",
      label: "标签",
      type: "multiselect",
    }, "a")).toEqual({ tags: ["a"] });
  });
});
