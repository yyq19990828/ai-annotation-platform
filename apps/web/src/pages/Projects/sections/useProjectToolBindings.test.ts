import { describe, expect, it } from "vitest";
import { buildUnitBindings, unitBindingsToPayload } from "./useProjectToolBindings";

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

describe("unitBindingsToPayload", () => {
  it("禁用但有配置的单位仍序列化 (enabled:false, 保留 classes/属性)", () => {
    const out = unitBindingsToPayload({
      bbox: {
        enabled: true,
        classRows: [{ name: "car", color: "#0ea5e9" }],
        attributeFields: [],
      },
      region: {
        enabled: false,
        classRows: [{ name: "road", color: "#22c55e" }],
        attributeFields: [{ key: "occluded", type: "boolean", label: "遮挡" }],
      },
    });

    expect(out.bbox?.enabled).toBe(true);
    // 修复前: 禁用单位整体被丢弃；修复后: enabled:false 但配置保留。
    expect(out.region?.enabled).toBe(false);
    expect(out.region?.classes).toEqual([
      { name: "road", color: "#22c55e", order: 0 },
    ]);
    expect(out.region?.attribute_schema).toEqual({
      fields: [{ key: "occluded", type: "boolean", label: "遮挡" }],
    });
  });

  it("纯空且禁用的单位不落库, 保持 tool_bindings 精简", () => {
    const out = unitBindingsToPayload({
      bbox: {
        enabled: true,
        classRows: [{ name: "car", color: "#0ea5e9" }],
        attributeFields: [],
      },
      region: { enabled: false, classRows: [], attributeFields: [] },
    });

    expect(out.bbox).toBeDefined();
    expect(out.region).toBeUndefined();
  });
});
