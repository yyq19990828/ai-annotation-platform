// v0.15.3 · 字段注册表完整性:key 与 category 一致、默认值可解析、patch 构造正确。
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKBENCH_PREFERENCES } from "@/api/auth";
import {
  WORKBENCH_SETTING_CATEGORY_LABELS,
  WORKBENCH_SETTING_FIELDS,
  buildFieldPatch,
  getFieldValue,
  lockableFieldName,
} from "./workbenchSettingsFields";

describe("workbenchSettingsFields 注册表", () => {
  it("每个字段 key 前缀与 category 一致,且分类有展示标签", () => {
    for (const field of WORKBENCH_SETTING_FIELDS) {
      expect(field.key.startsWith(`${field.category}.`)).toBe(true);
      expect(WORKBENCH_SETTING_CATEGORY_LABELS[field.category]).toBeTruthy();
    }
  });

  it("每个字段都能从 DEFAULT_WORKBENCH_PREFERENCES 解析出默认值(注册表与类型不漂移)", () => {
    for (const field of WORKBENCH_SETTING_FIELDS) {
      const value = getFieldValue(DEFAULT_WORKBENCH_PREFERENCES, field);
      expect(value).not.toBeUndefined();
    }
  });

  it("v0.15.3 红线:注册表只含现有 5 字段,默认值与现状一致", () => {
    expect(WORKBENCH_SETTING_FIELDS).toHaveLength(5);
    const byKey = Object.fromEntries(
      WORKBENCH_SETTING_FIELDS.map((f) => [
        f.key,
        getFieldValue(DEFAULT_WORKBENCH_PREFERENCES, f),
      ]),
    );
    expect(byKey).toEqual({
      "common.longTaskSampleRate": 0.05,
      "image.smoothImage": true,
      "image.cssImageFilter": "",
      "image.controlPointsSize": 6,
      "image.snapToGrid": false,
    });
  });

  it("buildFieldPatch 产出子树级 patch", () => {
    const field = WORKBENCH_SETTING_FIELDS.find(
      (f) => f.key === "image.controlPointsSize",
    )!;
    expect(buildFieldPatch(field, 12)).toEqual({ image: { controlPointsSize: 12 } });
    const common = WORKBENCH_SETTING_FIELDS.find(
      (f) => f.key === "common.longTaskSampleRate",
    )!;
    expect(buildFieldPatch(common, 0.2)).toEqual({ common: { longTaskSampleRate: 0.2 } });
  });

  it("lockableFieldName:image 4 个可锁字段映射平铺名,其余 null", () => {
    const names = WORKBENCH_SETTING_FIELDS.map((f) => lockableFieldName(f));
    expect(names.filter(Boolean).sort()).toEqual([
      "controlPointsSize",
      "cssImageFilter",
      "smoothImage",
      "snapToGrid",
    ]);
    const common = WORKBENCH_SETTING_FIELDS.find((f) => f.category === "common")!;
    expect(lockableFieldName(common)).toBeNull();
  });
});
