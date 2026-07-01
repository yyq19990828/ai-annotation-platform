// v0.20.11 · buildSecondaryInferencePayload 能力→请求参数映射单测。
import { describe, it, expect } from "vitest";
import type { MLModelCapability } from "@/api/ml-backends";
import {
  buildSecondaryInferencePayload,
  type SecondaryCapability,
} from "./useSecondaryInference";

function cap(
  model: Partial<MLModelCapability>,
  writeTarget: "attributes" | "geometry",
): SecondaryCapability {
  return {
    backendId: "be-1",
    backendName: "yolo",
    model: { id: "m1", ...model } as MLModelCapability,
    writeTarget,
    label: model.display_name || "m1",
  };
}

describe("buildSecondaryInferencePayload", () => {
  it("geometry: 带 model_variants (协议 v2), 无 write_keys", () => {
    const payload = buildSecondaryInferencePayload(
      cap(
        { id: "yolo-det", task: "detection", default_variants: { size: "l" } },
        "geometry",
      ),
    );
    expect(payload.ml_backend_id).toBe("be-1");
    expect(payload.write_target).toBe("geometry");
    expect(payload.model_id).toBe("yolo-det");
    expect(payload.model_variants).toEqual({ size: "l" });
    expect(payload.task_type).toBe("detection");
    expect(payload.write_keys).toBeNull();
  });

  it("geometry: 无 default_variants 回落 {} (仍走 v2 透传)", () => {
    const payload = buildSecondaryInferencePayload(
      cap({ id: "det2", task: "detection" }, "geometry"),
    );
    expect(payload.model_variants).toEqual({});
  });

  it("attributes: model_variants=null (扁平路径), write_keys 取输出属性 schema 键", () => {
    const payload = buildSecondaryInferencePayload(
      cap(
        {
          id: "onnx-cls",
          task: "classification",
          output_attribute_schema: [
            { key: "color", label: "颜色", type: "select", options: [] },
            { key: "vehicle_type", label: "类型", type: "select", options: [] },
          ] as MLModelCapability["output_attribute_schema"],
        },
        "attributes",
      ),
    );
    expect(payload.write_target).toBe("attributes");
    expect(payload.model_variants).toBeNull();
    expect(payload.write_keys).toEqual(["color", "vehicle_type"]);
    expect(payload.task_type).toBe("classification");
  });

  it("attributes: 无输出 schema → write_keys=null (全取)", () => {
    const payload = buildSecondaryInferencePayload(
      cap({ id: "ocr", task: "ocr" }, "attributes"),
    );
    expect(payload.write_keys).toBeNull();
  });
});
