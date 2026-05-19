/**
 * v0.10.17 · 工作台读取 project.tool_bindings 派生当前激活工具的类别与属性 schema.
 *
 * 给定 project + activeToolId, 返回:
 *   - classes: string[]              当前 tool_unit 内类别名列表 (按 order)
 *   - classesConfig: ClassesConfig  扁平形 (name → {color, alias, order}), 兼容 ClassPalette
 *   - attributeSchema: AttributeSchema  当前 tool_unit 的属性 schema
 *   - toolUnitId: ToolUnitId        派生出的工具单位 (供创建标注时 POST tool_unit_id)
 *
 * 老项目 (tool_bindings 为空) 走 fallback: 用 project.classes_config 全表 + activeUnit=bbox.
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
    const binding = tb[toolUnitId];
    if (binding && binding.enabled) {
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
      return { classes, classesConfig, attributeSchema, toolUnitId };
    }
    // Fallback: 老项目无 tool_bindings, 用项目级扁平字段
    return {
      classes: project?.classes ?? [],
      classesConfig: (project?.classes_config ?? {}) as ClassesConfig,
      attributeSchema:
        project?.attribute_schema ?? ({ fields: [] } as AttributeSchema),
      toolUnitId,
    };
  }, [project, toolUnitId]);
}
