/**
 * 整图预标注 model 选择:必须排除 crop-only 的识别原子(如 rapidocr 的 ocr-rec)。
 *
 * 回归:此前 OCR 选择用 `.find(m => m.task === "ocr")` 取第一个,rapidocr 自报顺序
 * [ocr-det, ocr-rec, ocr-e2e] 会先命中 crop 输入的 ocr-rec → 整图喂进识别原子、画布无框。
 */
import { describe, it, expect } from "vitest";
import { supportsFullImageInput } from "./usePreannotateConfig";
import type { MLModelCapability } from "@/api/ml-backends";

function model(id: string, task: string, supported_inputs?: string[]): MLModelCapability {
  return { id, task, supported_inputs };
}

describe("supportsFullImageInput", () => {
  it("显式 crop-only → 排除", () => {
    expect(supportsFullImageInput(model("ocr-rec", "ocr", ["crop"]))).toBe(false);
  });

  it("显式含 full_image → 放行", () => {
    expect(supportsFullImageInput(model("ocr-e2e", "ocr", ["full_image"]))).toBe(true);
  });

  it("缺字段 / 空数组(老 backend)→ 按兼容默认放行", () => {
    expect(supportsFullImageInput(model("legacy", "ocr"))).toBe(true);
    expect(supportsFullImageInput(model("legacy", "ocr", []))).toBe(true);
  });

  it("作为 OCR 选择过滤:rapidocr 顺序 [det, rec, e2e] 命中 e2e 而非 crop 的 rec", () => {
    const models = [
      model("ocr-det", "detection", ["full_image"]),
      model("ocr-rec", "ocr", ["crop"]),
      model("ocr-e2e", "ocr", ["full_image"]),
    ];
    const picked = models.find((m) => m.task === "ocr" && supportsFullImageInput(m));
    expect(picked?.id).toBe("ocr-e2e");
  });
});
