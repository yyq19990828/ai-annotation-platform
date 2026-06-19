import { describe, expect, it } from "vitest";
import {
  SELECTED_STROKE_BONUS,
  VISUAL_DEFAULTS,
  buildLabelText,
  buildTrackLabelText,
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
  labelContent: { single: [], track: ["id", "state"], ai: ["source", "score"] },
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

describe("buildLabelText(图片:单帧 / AI 段)", () => {
  it("单帧空段 · 只显类别名", () => {
    expect(buildLabelText({ className: "person", confidence: 1 }, [])).toBe("person");
  });

  it("AI 段 [source,score] · 前缀 + 类别 + 置信度", () => {
    expect(
      buildLabelText(
        { className: "person", confidence: 0.95, sourcePrefix: "✦ 模型 " },
        ["source", "score"],
      ),
    ).toBe("✦ 模型 person 95%");
  });

  it("关 score · AI 框去置信度,保留前缀 + 类别", () => {
    expect(
      buildLabelText({ className: "person", confidence: 0.95, sourcePrefix: "✦ 模型 " }, ["source"]),
    ).toBe("✦ 模型 person");
  });

  it("关 source · 前缀消失(source 受控,不再恒显)", () => {
    expect(
      buildLabelText({ className: "person", confidence: 0.95, sourcePrefix: "✦ 模型 " }, ["score"]),
    ).toBe("person 95%");
  });

  it("score 不再受 isAi 门控 · 给了 score token 即显示", () => {
    expect(buildLabelText({ className: "x", confidence: 0.5 }, ["score"])).toBe("x 50%");
  });

  it("勾 id · 显示 #id(类别名之后)", () => {
    expect(buildLabelText({ className: "car", instanceId: 7 }, ["id"])).toBe("car #7");
  });

  it("id 为空时不显示 # token", () => {
    expect(buildLabelText({ className: "car", instanceId: null }, ["id"])).toBe("car");
  });

  it("勾 attrs · bool 真值显键名、键值对显 k=v、空值跳过", () => {
    expect(
      buildLabelText(
        { className: "sign", attributes: { truncated: true, hidden: false, text: "STOP", note: "" } },
        ["attrs"],
      ),
    ).toBe("sign truncated text=STOP");
  });

  it("空段兜底 · 只显示类别名", () => {
    expect(buildLabelText({ className: "dog" }, [])).toBe("dog");
  });

  it("全勾 AI 段 · 前缀 类别 #id 置信度 属性 顺序拼接", () => {
    expect(
      buildLabelText(
        {
          className: "person",
          instanceId: 3,
          confidence: 0.8,
          sourcePrefix: "✦ 模型 ",
          attributes: { occluded: true },
        },
        ["source", "id", "score", "attrs"],
      ),
    ).toBe("✦ 模型 person #3 80% occluded");
  });
});

describe("buildTrackLabelText(视频:轨迹段)", () => {
  it("默认 [id,state] · #号 · 类别 · 状态(对齐旧硬编码观感)", () => {
    expect(
      buildTrackLabelText({ className: "car", trackNumber: 5, stateSuffix: "插值" }, ["id", "state"]),
    ).toBe("#5 · car · 插值");
  });

  it("无状态后缀 · #号 · 类别", () => {
    expect(buildTrackLabelText({ className: "car", trackNumber: 5 }, ["id", "state"])).toBe(
      "#5 · car",
    );
  });

  it("关 id · 去轨迹号", () => {
    expect(
      buildTrackLabelText({ className: "car", trackNumber: 5, stateSuffix: "遮挡" }, ["state"]),
    ).toBe("car · 遮挡");
  });

  it("关 state · 去状态后缀", () => {
    expect(
      buildTrackLabelText({ className: "car", trackNumber: 5, stateSuffix: "插值" }, ["id"]),
    ).toBe("#5 · car");
  });

  it("勾 attrs · 类别后接属性", () => {
    expect(
      buildTrackLabelText(
        { className: "car", trackNumber: 5, attributes: { occluded: true } },
        ["id", "attrs"],
      ),
    ).toBe("#5 · car · occluded");
  });

  it("空段 · 只类别名", () => {
    expect(buildTrackLabelText({ className: "car", trackNumber: 5 }, [])).toBe("car");
  });

  it("无 trackNumber · 即使勾 id 也不显 #", () => {
    expect(buildTrackLabelText({ className: "car" }, ["id", "state"])).toBe("car");
  });
});
