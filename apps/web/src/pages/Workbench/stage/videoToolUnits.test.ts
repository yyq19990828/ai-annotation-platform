import { describe, expect, it } from "vitest";
import type { ToolBindings } from "@/api/projects";
import { videoToolUnit, videoToolEnabled } from "./videoToolUnits";

describe("videoToolUnit", () => {
  it("几何工具映射到各自单位, select 无单位", () => {
    expect(videoToolUnit("box")).toBe("bbox");
    expect(videoToolUnit("track")).toBe("bbox");
    expect(videoToolUnit("polygon")).toBe("region");
    expect(videoToolUnit("polygon-track")).toBe("region");
    expect(videoToolUnit("polyline")).toBe("polyline");
    expect(videoToolUnit("polyline-track")).toBe("polyline");
    expect(videoToolUnit("select")).toBeNull();
  });
});

describe("videoToolEnabled", () => {
  it("select 恒可用; 空 tool_bindings 保守放行", () => {
    expect(videoToolEnabled("select", null)).toBe(true);
    expect(videoToolEnabled("polygon", {})).toBe(true);
  });

  it("单位未启用 → 工具不可用", () => {
    const tb: ToolBindings = { bbox: { enabled: true, classes: [] } };
    // region 未配置 → 多边形不可用
    expect(videoToolEnabled("polygon", tb)).toBe(false);
    expect(videoToolEnabled("box", tb)).toBe(true);
  });

  it("单位已启用但 video_modes 关掉对应变体 → 不可用", () => {
    const tb: ToolBindings = {
      region: { enabled: true, classes: [], video_modes: { box: false, track: true } },
    };
    expect(videoToolEnabled("polygon", tb)).toBe(false); // 单帧关
    expect(videoToolEnabled("polygon-track", tb)).toBe(true); // 轨迹开
  });

  it("video_modes 为 null → 单帧/轨迹均可用", () => {
    const tb: ToolBindings = { polyline: { enabled: true, classes: [] } };
    expect(videoToolEnabled("polyline", tb)).toBe(true);
    expect(videoToolEnabled("polyline-track", tb)).toBe(true);
  });
});

// v0.21.23 · 交互式 SAM 工具必须登记进 VIDEO_TOOL_TARGET，否则 videoToolEnabled 的
// 「未知工具 → true」会静默放行、绕过全部 tool_bindings 门控（本 epic 头号陷阱）。
describe("videoToolUnits · 交互式 SAM 工具", () => {
  it("smart-point / smart-box / exemplar 按产出几何归 region 单位", () => {
    expect(videoToolUnit("smart-point")).toBe("region");
    expect(videoToolUnit("smart-box")).toBe("region");
    expect(videoToolUnit("exemplar")).toBe("region");
  });

  it("region 单位未启用 → smart-* 不可用（不得被当作未知工具放行）", () => {
    const tb: ToolBindings = {
      bbox: { enabled: true, classes: [], attribute_schema: { fields: [] } },
      region: { enabled: false, classes: [], attribute_schema: { fields: [] } },
    } as unknown as ToolBindings;
    expect(videoToolEnabled("smart-point", tb)).toBe(false);
    expect(videoToolEnabled("smart-box", tb)).toBe(false);
    expect(videoToolEnabled("exemplar", tb)).toBe(false);
    expect(videoToolEnabled("box", tb)).toBe(true);
  });

  it("region 启用但单帧变体关闭 → smart-* 不可用（它们产单帧几何）", () => {
    const tb: ToolBindings = {
      region: {
        enabled: true,
        classes: [],
        attribute_schema: { fields: [] },
        video_modes: { box: false, track: true },
      },
    } as unknown as ToolBindings;
    expect(videoToolEnabled("smart-point", tb)).toBe(false);
    expect(videoToolEnabled("polygon-track", tb)).toBe(true);
  });

  it("region 启用且单帧变体开启 → smart-* 可用", () => {
    const tb: ToolBindings = {
      region: {
        enabled: true,
        classes: [],
        attribute_schema: { fields: [] },
        video_modes: { box: true, track: false },
      },
    } as unknown as ToolBindings;
    expect(videoToolEnabled("smart-point", tb)).toBe(true);
    expect(videoToolEnabled("smart-box", tb)).toBe(true);
    expect(videoToolEnabled("exemplar", tb)).toBe(true);
  });
});
