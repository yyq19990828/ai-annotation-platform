import { describe, expect, it } from "vitest";

import type { ToolBindings } from "@/api/projects";
import { box3dAttributeSchema } from "./box3dAttributes";

describe("box3dAttributeSchema", () => {
  it("returns undefined when lidar_box_3d is not configured", () => {
    expect(box3dAttributeSchema({})).toBeUndefined();
    expect(box3dAttributeSchema(undefined)).toBeUndefined();
  });

  it("returns undefined when lidar_box_3d is disabled", () => {
    const bindings: ToolBindings = {
      lidar_box_3d: {
        enabled: false,
        attribute_schema: { fields: [{ key: "occluded", label: "遮挡", type: "boolean" }] },
      },
    };
    expect(box3dAttributeSchema(bindings)).toBeUndefined();
  });

  it("returns the configured lidar_box_3d attribute schema", () => {
    const schema = {
      fields: [
        { key: "occluded", label: "遮挡", type: "boolean" as const },
        {
          key: "visibility",
          label: "可见度",
          type: "select" as const,
          options: [{ value: "partial", label: "部分" }],
        },
      ],
    };
    const bindings: ToolBindings = {
      lidar_box_3d: { enabled: true, attribute_schema: schema },
    };
    expect(box3dAttributeSchema(bindings)).toBe(schema);
  });
});
