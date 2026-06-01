import { describe, expect, it } from "vitest";
import { buildUnitBindings } from "./useProjectToolBindings";

describe("buildUnitBindings", () => {
  it("keeps video project settings on the video tool-unit set", () => {
    const bindings = buildUnitBindings({
      data_type: "video",
      type_key: "video-track",
      tool_bindings: {
        bbox: {
          enabled: true,
          classes: [{ name: "car", color: "#0ea5e9", order: 0 }],
          attribute_schema: { fields: [] },
        },
        region: {
          enabled: true,
          classes: [{ name: "person", color: "#22c55e", order: 0 }],
          attribute_schema: { fields: [] },
        },
        rotated_bbox: {
          enabled: true,
          classes: [{ name: "ship", color: "#f97316", order: 0 }],
          attribute_schema: { fields: [] },
        },
        ai_interactive: {
          enabled: true,
          classes: [{ name: "prompt", color: "#a855f7", order: 0 }],
          attribute_schema: { fields: [] },
        },
      },
    });

    expect(Object.keys(bindings)).toEqual(["bbox"]);
    expect(bindings.bbox?.enabled).toBe(true);
    expect(bindings.bbox?.classRows).toEqual([
      { name: "car", color: "#0ea5e9" },
    ]);
    expect(bindings.region).toBeUndefined();
    expect(bindings.rotated_bbox).toBeUndefined();
    expect(bindings.ai_interactive).toBeUndefined();
  });

  it("maps legacy video classes into bbox without adding image units", () => {
    const bindings = buildUnitBindings({
      data_type: "video",
      type_key: "video-track",
      classes: ["vehicle"],
      classes_config: {
        vehicle: { color: "#0ea5e9", order: 0, alias: "vehicle" },
      },
      attribute_schema: {
        fields: [{ key: "occluded", type: "boolean", label: "Occluded" }],
      },
      tool_bindings: {},
    });

    expect(Object.keys(bindings)).toEqual(["bbox"]);
    expect(bindings.bbox?.enabled).toBe(true);
    expect(bindings.bbox?.classRows).toEqual([
      { name: "vehicle", color: "#0ea5e9", alias: "vehicle" },
    ]);
    expect(bindings.bbox?.attributeFields).toEqual([
      { key: "occluded", type: "boolean", label: "Occluded" },
    ]);
  });
});
