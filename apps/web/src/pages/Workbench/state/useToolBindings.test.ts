/**
 * v0.10.17 · useToolBindings 派生 classes / fallback 行为单测.
 *
 * 关键 case:
 *   - 当前 tool_unit 配置正常 → 按 order 出 classes
 *   - ai_interactive unit 为空 + bbox unit 有配 → 回落到 bbox 的 classes
 *     (兼容历史项目升级后 ai_interactive 未填充的场景)
 *   - 完全空的 tool_bindings → 走老项目 fallback (扁平 classes_config)
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProjectResponse } from "@/api/projects";
import type { ToolId } from "../stage/tools";
import { useToolBindings } from "./useToolBindings";

function _proj(extra: Partial<ProjectResponse>): ProjectResponse {
  return {
    id: "p-1",
    display_id: "P-1",
    name: "t",
    type_label: "图像-检测",
    type_key: "image-det",
    owner_id: "u-1",
    classes: [],
    classes_config: {},
    attribute_schema: { fields: [] },
    tool_bindings: {},
    ...extra,
  } as ProjectResponse;
}

describe("useToolBindings · v0.10.17", () => {
  it("返回当前工具单位下的 classes / classesConfig", () => {
    const proj = _proj({
      tool_bindings: {
        bbox: {
          enabled: true,
          classes: [
            { name: "person", color: "#fff", order: 0 },
            { name: "car", color: "#000", order: 1 },
          ],
          attribute_schema: { fields: [] },
        },
      },
    });
    const { result } = renderHook(() =>
      useToolBindings(proj, "box" as ToolId),
    );
    expect(result.current.toolUnitId).toBe("bbox");
    expect(result.current.classes).toEqual(["person", "car"]);
    expect(result.current.classesConfig.person.color).toBe("#fff");
  });

  it("按 order 升序排; 缺 order 当作 0 (向前排, 保稳定)", () => {
    const proj = _proj({
      tool_bindings: {
        bbox: {
          enabled: true,
          classes: [
            { name: "b", order: 2 },
            { name: "a", order: 0 },
            { name: "c" }, // 缺 order → 0
          ],
          attribute_schema: { fields: [] },
        },
      },
    });
    const { result } = renderHook(() =>
      useToolBindings(proj, "box" as ToolId),
    );
    // 0(a) — 0(c, 输入序在 a 之后) — 2(b); JS 稳定排序保留同 key 相对顺序.
    expect(result.current.classes).toEqual(["a", "c", "b"]);
  });

  it("ai_interactive 单位空 → 回落到 bbox 单位的 classes (toolUnitId 仍为 ai_interactive)", () => {
    const proj = _proj({
      tool_bindings: {
        bbox: {
          enabled: true,
          classes: [{ name: "person", order: 0 }],
          attribute_schema: { fields: [] },
        },
        // ai_interactive 完全未配
      },
    });
    const { result } = renderHook(() =>
      useToolBindings(proj, "smart-box" as ToolId),
    );
    expect(result.current.toolUnitId).toBe("ai_interactive");
    expect(result.current.classes).toEqual(["person"]);
  });

  it("ai_interactive 单位 enabled 但 classes 为空 → 也回落", () => {
    const proj = _proj({
      tool_bindings: {
        bbox: {
          enabled: true,
          classes: [{ name: "person", order: 0 }],
          attribute_schema: { fields: [] },
        },
        ai_interactive: {
          enabled: true,
          classes: [],
          attribute_schema: { fields: [] },
        },
      },
    });
    const { result } = renderHook(() =>
      useToolBindings(proj, "magic-box" as ToolId),
    );
    expect(result.current.classes).toEqual(["person"]);
  });

  it("tool_bindings 完全空 → 返回空视图 (v0.10.22 单源, 扁平字段由 tool_bindings 派生)", () => {
    const proj = _proj({
      tool_bindings: {},
    });
    const { result } = renderHook(() =>
      useToolBindings(proj, "box" as ToolId),
    );
    expect(result.current.classes).toEqual([]);
    expect(result.current.classesConfig).toEqual({});
  });

  it("bbox unit disabled 且无其它 unit → 空视图", () => {
    const proj = _proj({
      tool_bindings: {
        bbox: {
          enabled: false,
          classes: [{ name: "ignored", order: 0 }],
          attribute_schema: { fields: [] },
        },
      },
    });
    const { result } = renderHook(() =>
      useToolBindings(proj, "box" as ToolId),
    );
    expect(result.current.classes).toEqual([]);
  });
});
