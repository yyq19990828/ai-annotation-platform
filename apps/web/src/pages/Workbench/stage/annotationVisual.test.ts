import { describe, expect, it } from "vitest";
import {
  SELECTED_STROKE_BONUS,
  VISUAL_DEFAULTS,
  buildLabelText,
  fillAlpha,
  shouldShowLabel,
  strokeWidthFor,
  type AnnotationVisualConfig,
} from "./annotationVisual";

const CFG: AnnotationVisualConfig = {
  labelFontSize: VISUAL_DEFAULTS.labelFontSize,
  strokeWidth: VISUAL_DEFAULTS.strokeWidth,
  fillOpacity: VISUAL_DEFAULTS.fillOpacity,
  fillOpacitySelected: VISUAL_DEFAULTS.fillOpacitySelected,
  labelVisibility: "always",
  labelContent: ["class", "score"],
};

describe("strokeWidthFor", () => {
  it("非选中 = base,选中 = base + 0.5", () => {
    expect(strokeWidthFor(false, CFG)).toBe(1.5);
    expect(strokeWidthFor(true, CFG)).toBe(1.5 + SELECTED_STROKE_BONUS);
  });
  it("跟随自定义 base", () => {
    expect(strokeWidthFor(false, { strokeWidth: 3 })).toBe(3);
    expect(strokeWidthFor(true, { strokeWidth: 3 })).toBe(3.5);
  });
});

describe("fillAlpha", () => {
  it("非选中走 fillOpacity,选中走 fillOpacitySelected", () => {
    expect(fillAlpha(false, CFG)).toBe(0.07);
    expect(fillAlpha(true, CFG)).toBe(0.12);
  });
});

describe("shouldShowLabel", () => {
  it("always:恒显", () => {
    expect(shouldShowLabel(false, "always")).toBe(true);
    expect(shouldShowLabel(true, "always")).toBe(true);
  });
  it("selected:仅选中", () => {
    expect(shouldShowLabel(false, "selected")).toBe(false);
    expect(shouldShowLabel(true, "selected")).toBe(true);
  });
  it("none:从不", () => {
    expect(shouldShowLabel(false, "none")).toBe(false);
    expect(shouldShowLabel(true, "none")).toBe(false);
  });
});

describe("buildLabelText", () => {
  it("默认 [class,score] · 人工框只显类别名(conf 不计,isAi 门控)", () => {
    expect(
      buildLabelText({ className: "person", confidence: 1, isAi: false }, ["class", "score"]),
    ).toBe("person");
  });

  it("默认 [class,score] · AI 框保持现状(前缀 + 类别 + 置信度)", () => {
    expect(
      buildLabelText(
        { className: "person", confidence: 0.95, isAi: true, aiPrefix: "✦ 模型 " },
        ["class", "score"],
      ),
    ).toBe("✦ 模型 person 95%");
  });

  it("取消 score · AI 框去掉置信度,保留前缀 + 类别", () => {
    expect(
      buildLabelText(
        { className: "person", confidence: 0.95, isAi: true, aiPrefix: "✦ 模型 " },
        ["class"],
      ),
    ).toBe("✦ 模型 person");
  });

  it("勾选 id · 显示 #id(类别名之后)", () => {
    expect(
      buildLabelText({ className: "car", instanceId: 7, isAi: false }, ["class", "id"]),
    ).toBe("car #7");
  });

  it("id 为空时不显示 # token", () => {
    expect(
      buildLabelText({ className: "car", instanceId: null, isAi: false }, ["class", "id"]),
    ).toBe("car");
  });

  it("勾选 attrs · bool 真值显键名、键值对显 k=v、空值跳过", () => {
    expect(
      buildLabelText(
        {
          className: "sign",
          isAi: false,
          attributes: { truncated: true, hidden: false, text: "STOP", note: "" },
        },
        ["class", "attrs"],
      ),
    ).toBe("sign truncated text=STOP");
  });

  it("min:1 兜底 · content 为空仍显示类别名", () => {
    expect(buildLabelText({ className: "dog", isAi: false }, [])).toBe("dog");
  });

  it("全勾选 · class #id score attrs 顺序拼接", () => {
    expect(
      buildLabelText(
        {
          className: "person",
          instanceId: 3,
          confidence: 0.8,
          isAi: true,
          aiPrefix: "✦ 模型 ",
          attributes: { occluded: true },
        },
        ["class", "id", "score", "attrs"],
      ),
    ).toBe("✦ 模型 person #3 80% occluded");
  });
});
