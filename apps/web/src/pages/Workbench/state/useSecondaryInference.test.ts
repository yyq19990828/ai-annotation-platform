// v0.20.11 · buildSecondaryInferencePayload 能力→请求参数映射单测。
import { describe, it, expect } from "vitest";
import type { MLModelCapability } from "@/api/ml-backends";
import {
  buildSecondaryInferencePayload,
  needsTextPrompt,
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

  it("params: 用户调过的参数带进请求; 空 → null", () => {
    const c = cap({ id: "det", task: "detection" }, "geometry");
    expect(
      buildSecondaryInferencePayload(c, { score_threshold: 0.4 }).params,
    ).toEqual({ score_threshold: 0.4 });
    expect(buildSecondaryInferencePayload(c, {}).params).toBeNull();
    expect(buildSecondaryInferencePayload(c).params).toBeNull();
  });

  it("variants: 用户所选档位覆盖模型默认 (缺轴回落默认)", () => {
    const c = cap(
      { id: "yolo-det", task: "detection", default_variants: { series: "yolo11", size: "l" } },
      "geometry",
    );
    // 用户只改 size, series 保留默认。
    expect(
      buildSecondaryInferencePayload(c, undefined, { size: "s" }).model_variants,
    ).toEqual({ series: "yolo11", size: "s" });
    // 未传 variants → 纯默认。
    expect(buildSecondaryInferencePayload(c).model_variants).toEqual({
      series: "yolo11",
      size: "l",
    });
  });

  it("variants: 无变体轴的 attributes 能力 → null (走扁平路径)", () => {
    const c = cap({ id: "cls", task: "classification" }, "attributes");
    expect(
      buildSecondaryInferencePayload(c, undefined, { size: "s" }).model_variants,
    ).toBeNull();
  });

  it("variants: 有变体轴的 OCR 属性能力 → 带 model_variants (协议 v2)", () => {
    // rapidocr rec/e2e 是 attributes 写回, 但声明了 version/size/lang 轴, 也要能选档透传。
    const c = cap(
      {
        id: "ocr-rec",
        task: "ocr",
        default_variants: { version: "v5", size: "mobile", lang: "universal" },
        supported_variants: [
          { key: "lang", variants: [{ value: "universal" }, { value: "en" }] },
        ] as MLModelCapability["supported_variants"],
      },
      "attributes",
    );
    // 用户改 lang, version/size 保留默认。
    expect(
      buildSecondaryInferencePayload(c, undefined, { lang: "en" }).model_variants,
    ).toEqual({ version: "v5", size: "mobile", lang: "en" });
  });

  it("prompt: 开集文本带进请求 (trim); 空/空白 → null", () => {
    const c = cap({ id: "gdino", task: "detection" }, "geometry");
    expect(
      buildSecondaryInferencePayload(c, undefined, undefined, "  car . person  ")
        .prompt,
    ).toBe("car . person");
    expect(buildSecondaryInferencePayload(c, undefined, undefined, "   ").prompt).toBeNull();
    expect(buildSecondaryInferencePayload(c).prompt).toBeNull();
  });

  it("needsTextPrompt: supported_prompts 含 text → true", () => {
    expect(
      needsTextPrompt(cap({ id: "g", supported_prompts: ["text"] }, "geometry")),
    ).toBe(true);
    expect(
      needsTextPrompt(cap({ id: "y", supported_prompts: ["none"] }, "geometry")),
    ).toBe(false);
    expect(needsTextPrompt(cap({ id: "z" }, "geometry"))).toBe(false);
  });
});
