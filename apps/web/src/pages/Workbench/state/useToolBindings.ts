/**
 * v0.10.17 · 工作台读取 project.tool_bindings 派生当前激活工具的类别与属性 schema.
 *
 * 给定 project + activeToolId, 返回:
 *   - classes: string[]              当前 tool_unit 内类别名列表 (按 order)
 *   - classesConfig: ClassesConfig  扁平形 (name → {color, alias, order}), 兼容 ClassPalette
 *   - attributeSchema: AttributeSchema  当前 tool_unit 的属性 schema
 *   - toolUnitId: ToolUnitId        派生出的工具单位 (供创建标注时 POST tool_unit_id)
 *
 * v0.10.22 · tool_bindings 是唯一真值 (全部项目已 backfill). 当前 unit 未配置类时,
 * 借 bbox / region 默认 unit 的类名展示; 都为空则返回空视图.
 */

import { useMemo } from "react";
import type {
  AttributeSchema,
  ClassesConfig,
  ProjectResponse,
  ToolBindings,
} from "@/api/projects";
import type { ToolUnitId } from "@/constants/toolUnits";
import type { ToolId } from "../stage/tools";
import { toolUnitForTool } from "../stage/tools/toolUnits";

export interface ToolBindingsView {
  classes: string[];
  classesConfig: ClassesConfig;
  attributeSchema: AttributeSchema;
  toolUnitId: ToolUnitId;
}

export function useToolBindings(
  project: ProjectResponse | null | undefined,
  activeToolId: ToolId,
): ToolBindingsView {
  const toolUnitId = toolUnitForTool(activeToolId);
  return useMemo(() => {
    const tb = (project?.tool_bindings ?? {}) as ToolBindings;
    const view = _materialize(tb, toolUnitId);
    if (view.classes.length > 0) {
      return view;
    }
    // v0.10.17 兜底: 当前 unit 未配置或类集合为空 (尤其是
    // ai_interactive — 历史项目升级后曾因迁移漏配导致 AI 调色板清空).
    // 退到 bbox / region 默认 unit 借类名; toolUnitId 仍保持当前激活工具的 unit,
    // 让 POST 写入时仍按工具维度落 tool_unit_id, 仅 UI 借用类名展示.
    for (const fallbackUnit of ["bbox", "region"] as const) {
      if (fallbackUnit === toolUnitId) continue;
      const fb = _materialize(tb, fallbackUnit);
      if (fb.classes.length > 0) {
        return { ...fb, toolUnitId };
      }
    }
    return { ...view, toolUnitId };
  }, [project, toolUnitId]);
}

function _materialize(
  tb: ToolBindings,
  unit: ToolUnitId,
): ToolBindingsView {
  const binding = tb[unit];
  if (!binding || !binding.enabled) {
    return {
      classes: [],
      classesConfig: {} as ClassesConfig,
      attributeSchema: { fields: [] } as AttributeSchema,
      toolUnitId: unit,
    };
  }
  const ordered = (binding.classes ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const classes = ordered.map((c) => c.name);
  const classesConfig: ClassesConfig = {};
  ordered.forEach((c, i) => {
    classesConfig[c.name] = {
      color: c.color ?? null,
      order: c.order ?? i,
      alias: c.alias ?? null,
    };
  });
  const attributeSchema: AttributeSchema =
    (binding.attribute_schema as AttributeSchema | undefined) ?? {
      fields: [],
    };
  return { classes, classesConfig, attributeSchema, toolUnitId: unit };
}
