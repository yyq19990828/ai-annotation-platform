import { describe, expect, it } from "vitest";
import type { MLModelCapability } from "@/api/ml-backends";
import { derivePanelShape } from "./panelShape";

function model(overrides: Partial<MLModelCapability>): MLModelCapability {
  return { id: "m1", ...overrides };
}

describe("derivePanelShape", () => {
  it("YOLO detection (闭集, 单一 bbox): 隐藏输出形态 + 强制 box + 类别筛选", () => {
    const shape = derivePanelShape(
      model({
        task: "detection",
        supported_prompts: ["none"],
        supported_geometric_outputs: ["bbox"],
      }),
      false,
    );
    expect(shape.showOutputMode).toBe(false);
    expect(shape.forcedOutputMode).toBe("box");
    expect(shape.promptKind).toBe("class_filter");
  });

  it("YOLO segmentation (闭集, 单一 polygon): 隐藏输出形态 + 强制 mask", () => {
    const shape = derivePanelShape(
      model({
        task: "segmentation",
        supported_prompts: ["none"],
        supported_geometric_outputs: ["polygon"],
      }),
      false,
    );
    expect(shape.showOutputMode).toBe(false);
    expect(shape.forcedOutputMode).toBe("mask");
    expect(shape.promptKind).toBe("class_filter");
  });

  it("gsam2 (开集 text, 框+掩膜): 显示输出形态三选 + Prompt", () => {
    const shape = derivePanelShape(
      model({
        task: "detection",
        supported_prompts: ["text", "bbox"],
        supported_geometric_outputs: ["bbox", "polygon"],
      }),
      false,
    );
    expect(shape.showOutputMode).toBe(true);
    expect(shape.forcedOutputMode).toBe(null);
    expect(shape.promptKind).toBe("prompt");
  });

  it("keypoint (无框/掩膜概念): 隐藏输出形态, 不强制", () => {
    const shape = derivePanelShape(
      model({
        task: "keypoint",
        supported_prompts: ["none"],
        supported_geometric_outputs: ["keypoint"],
      }),
      false,
    );
    expect(shape.showOutputMode).toBe(false);
    expect(shape.forcedOutputMode).toBe(null);
  });

  it("isDocMode: 隐藏输出形态 + prompt none", () => {
    const shape = derivePanelShape(model({ task: "ocr" }), true);
    expect(shape.showOutputMode).toBe(false);
    expect(shape.promptKind).toBe("none");
  });

  it("能力声明不全 (无字段): 安全兜底为显示输出形态 + 文本 prompt, 不藏可用字段", () => {
    const shape = derivePanelShape(model({ task: "detection" }), false);
    expect(shape.showOutputMode).toBe(true);
    expect(shape.forcedOutputMode).toBe(null);
    expect(shape.promptKind).toBe("prompt");
  });

  it("model 为空 (能力未就位): 兜底显示 + 文本 prompt", () => {
    const shape = derivePanelShape(undefined, false);
    expect(shape.showOutputMode).toBe(true);
    expect(shape.promptKind).toBe("prompt");
  });
});
