// v0.16.x 第 2 批 · ThreeDWorkbench PSR 表单纯逻辑测试守护(伴随从 schedulePatch /
// handleFieldBlur 提炼,锁定字段校验与 form→geometry 转换行为)。
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cameraLayerClipPath,
  buildThreeDLayoutPreset,
  isPsrFieldBad,
  loadCameraSample,
  parsePsrForm,
  psrFormToGeometry,
} from "./ThreeDWorkbench.helpers";
import type { PsrField } from "./ThreeDWorkbench.helpers";
import type { SensorCalibration } from "@/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const FULL_FORM: Record<PsrField, string> = {
  cx: "1",
  cy: "2",
  cz: "3",
  l: "4",
  w: "5",
  h: "6",
  yaw: "90",
  pitch: "0",
  roll: "0",
};

describe("loadCameraSample", () => {
  it("取消过期上色任务时立即停止相机图加载", async () => {
    class PendingImage {
      crossOrigin = "";
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
    }
    vi.stubGlobal("Image", PendingImage);
    const controller = new AbortController();
    const calibration = {
      extrinsic: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      intrinsic: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    } as SensorCalibration;
    let settled = false;

    const sample = loadCameraSample(
      "https://assets.test/stale-colorize.jpg",
      calibration,
      controller.signal,
    ).then((result) => {
      settled = true;
      return result;
    });
    controller.abort();
    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(sample).resolves.toBeNull();
  });
});

describe("isPsrFieldBad", () => {
  it("空字符串非法", () => expect(isPsrFieldBad("cx", "")).toBe(true));
  it("非数字非法", () => expect(isPsrFieldBad("cx", "abc")).toBe(true));
  it("尺寸字段 <= 0 非法", () => {
    expect(isPsrFieldBad("l", "0")).toBe(true);
    expect(isPsrFieldBad("w", "-1")).toBe(true);
  });
  it("中心/朝向字段允许 0 与负数", () => {
    expect(isPsrFieldBad("cx", "0")).toBe(false);
    expect(isPsrFieldBad("yaw", "-30")).toBe(false);
  });
  it("尺寸字段正数合法", () => expect(isPsrFieldBad("h", "1.5")).toBe(false));
});

describe("parsePsrForm", () => {
  it("全字段有效时 valid=true 并解析为数值", () => {
    const { values, valid } = parsePsrForm(FULL_FORM);
    expect(valid).toBe(true);
    expect(values.cx).toBe(1);
    expect(values.yaw).toBe(90);
  });
  it("尺寸为 0 时 valid=false", () => {
    expect(parsePsrForm({ ...FULL_FORM, l: "0" }).valid).toBe(false);
  });
  it("空字段时 valid=false", () => {
    expect(parsePsrForm({ ...FULL_FORM, cx: "" }).valid).toBe(false);
  });
  it("非有限数时 valid=false", () => {
    expect(parsePsrForm({ ...FULL_FORM, cz: "abc" }).valid).toBe(false);
  });
});

describe("psrFormToGeometry", () => {
  it("组装为 box_3d geometry,朝向°转弧度(rotation=[roll, pitch, yaw])", () => {
    const { values } = parsePsrForm(FULL_FORM);
    const deg = Math.PI / 180;
    expect(psrFormToGeometry(values, "raw")).toEqual({
      type: "box_3d",
      center: [1, 2, 3],
      size: [4, 5, 6],
      rotation: [0 * deg, 0 * deg, 90 * deg],
      convention_at_create: "raw",
    });
  });
});

describe("buildThreeDLayoutPreset", () => {
  const roles = ["front", "side", "front"];

  it("框体精修只展开默认三视图并收起当前相机 role", () => {
    expect(buildThreeDLayoutPreset("box-refinement", roles)).toEqual({
      triViewFloat: { collapsed: false, x: null, y: null, w: null, h: null },
      cameraPanels: {
        front: { x: null, y: null, collapsed: true },
        side: { x: null, y: null, collapsed: true },
      },
    });
  });

  it("传感器融合清空相机自定义记录并收起默认三视图", () => {
    expect(buildThreeDLayoutPreset("sensor-fusion", roles)).toEqual({
      triViewFloat: { collapsed: true, x: null, y: null, w: null, h: null },
      cameraPanels: {},
    });
  });

  it("点级分割收起三视图与当前全部相机，但不含其他布局字段", () => {
    const patch = buildThreeDLayoutPreset("point-segmentation", roles);
    expect(patch).toEqual({
      triViewFloat: { collapsed: true, x: null, y: null, w: null, h: null },
      cameraPanels: {
        front: { x: null, y: null, collapsed: true },
        side: { x: null, y: null, collapsed: true },
      },
    });
    expect(Object.keys(patch).sort()).toEqual(["cameraPanels", "triViewFloat"]);
  });

  it.each([0, 1, 2, 6])("按 manifest 的 %i 路相机生成且不虚构 role", (count) => {
    const matrixRoles = Array.from({ length: count }, (_, index) => `camera-${index + 1}`);
    expect(
      Object.keys(buildThreeDLayoutPreset("box-refinement", matrixRoles).cameraPanels ?? {}),
    ).toEqual(matrixRoles);
  });
});

describe("cameraLayerClipPath", () => {
  const viewport = { left: 100, top: 50, right: 900, bottom: 650 };

  it("在相机层中挖出三视图面板矩形，避免相机穿透透明正交视口", () => {
    expect(cameraLayerClipPath(viewport, { x: 620, y: 140, w: 240, h: 360 })).toBe(
      "polygon(evenodd, 0px 0px, 800px 0px, 800px 600px, 0px 600px, 0px 0px, 520px 90px, 520px 450px, 760px 450px, 760px 90px, 520px 90px)",
    );
  });

  it("面板越界时把裁剪孔限制在相机层内", () => {
    expect(cameraLayerClipPath(viewport, { x: 40, y: 20, w: 120, h: 100 })).toBe(
      "polygon(evenodd, 0px 0px, 800px 0px, 800px 600px, 0px 600px, 0px 0px, 0px 0px, 0px 70px, 60px 70px, 60px 0px, 0px 0px)",
    );
  });

  it("三视图不与相机层相交时不创建裁剪", () => {
    expect(cameraLayerClipPath(viewport, { x: 920, y: 700, w: 50, h: 50 })).toBeUndefined();
  });
});
