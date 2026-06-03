import { describe, it, expect } from "vitest";
import type { SensorCalibration } from "@/types";
import { cameraAnchor } from "./cameraAnchor";

/** 只有第三行 (光轴前向) 影响外参兜底;其余填 0/单位即可。 */
function extWithForward(fx: number, fy: number, fz: number): SensorCalibration {
  const e = [1, 0, 0, 0, 0, 1, 0, 0, fx, fy, fz, 0, 0, 0, 0, 1];
  return {
    extrinsic: e as unknown as SensorCalibration["extrinsic"],
    intrinsic: [1, 0, 0, 0, 1, 0, 0, 0, 1] as unknown as SensorCalibration["intrinsic"],
  };
}

describe("cameraAnchor · 名字优先", () => {
  it("front/rear/left/right → 四主向", () => {
    expect(cameraAnchor(null, "front")).toBe("top");
    expect(cameraAnchor(null, "rear")).toBe("bottom");
    expect(cameraAnchor(null, "back")).toBe("bottom");
    expect(cameraAnchor(null, "left")).toBe("left");
    expect(cameraAnchor(null, "right")).toBe("right");
  });

  it("复合朝向先于简单命中(front_left ≠ front)", () => {
    expect(cameraAnchor(null, "front_left")).toBe("top-left");
    expect(cameraAnchor(null, "front-right")).toBe("top-right");
    expect(cameraAnchor(null, "rear_left")).toBe("bottom-left");
    expect(cameraAnchor(null, "back_right")).toBe("bottom-right");
  });

  it("大小写 / 前缀不敏感", () => {
    expect(cameraAnchor(null, "CAM_FRONT")).toBe("top");
    expect(cameraAnchor(null, "Camera/Left")).toBe("left");
  });
});

describe("cameraAnchor · 外参兜底(标准系 X=前/Y=左)", () => {
  it("无可识别名字时按光轴方位推", () => {
    expect(cameraAnchor(extWithForward(1, 0, 0), "cam_0")).toBe("top"); // +X 前
    expect(cameraAnchor(extWithForward(0, 1, 0), "cam_1")).toBe("left"); // +Y 左
    expect(cameraAnchor(extWithForward(-1, 0, 0), "cam_2")).toBe("bottom"); // -X 后
    expect(cameraAnchor(extWithForward(0, -1, 0), "cam_3")).toBe("right"); // -Y 右
  });

  it("光轴近垂直(水平退化)→ overflow", () => {
    expect(cameraAnchor(extWithForward(0, 0, -1), "cam_down")).toBe("overflow");
  });
});

describe("cameraAnchor · 兜底与回归", () => {
  it("无名字命中且无标定 → overflow", () => {
    expect(cameraAnchor(null, "sensor_x")).toBe("overflow");
  });

  it("回归:名字优先压过外参 —— 示例集 front 外参方位是 -Y(-91.9°),仍按名字落 top", () => {
    // 示例集 front 相机真实光轴前向 ≈ (-0.033, -0.999, 0.042)(lidar 系前向是 -Y,非标准)。
    const sustechFront = extWithForward(-0.033, -0.999, 0.042);
    // 若误用外参分支会落 "right";名字优先保证落 "top"。
    expect(cameraAnchor(sustechFront, "front")).toBe("top");
  });
});
