/**
 * v0.10.17 · ClassesSection / AttributesSection / TemplateEditModal 共享 hook.
 *
 * 从 project.tool_bindings (或老 classes_config 派生兜底) 反推出按 ToolUnitId 拆分
 * 的编辑状态; 保存时把当前各 unit 的 classRows / attributeFields 序列化回 tool_bindings.
 */

import { useEffect, useMemo, useState } from "react";
import type {
  AttributeField,
  AttributeSchema,
  ClassConfigEntry,
  ClassesConfig,
  ProjectResponse,
  ToolBindings,
} from "@/api/projects";
import { defaultColorFor, type ClassRow } from "./ClassEditor";
import {
  TOOL_UNIT_GROUPS,
  toolUnitFromLegacy,
  type ToolUnitId,
} from "@/constants/toolUnits";

export interface UnitBindingState {
  enabled: boolean;
  classRows: ClassRow[];
  attributeFields: AttributeField[];
}

export type UnitBindingMap = Partial<Record<ToolUnitId, UnitBindingState>>;

export function buildUnitBindings(project: {
  type_key?: string;
  classes?: string[];
  classes_config?: ClassesConfig | null;
  attribute_schema?: AttributeSchema | null;
  tool_bindings?: ToolBindings | null;
}): UnitBindingMap {
  const out: UnitBindingMap = {};
  for (const g of TOOL_UNIT_GROUPS) {
    if (!g.available) continue;
    out[g.id] = { enabled: false, classRows: [], attributeFields: [] };
  }

  const tb = (project.tool_bindings ?? {}) as ToolBindings;
  if (Object.keys(tb).length > 0) {
    for (const k of Object.keys(tb) as ToolUnitId[]) {
      const b = tb[k];
      if (!b) continue;
      const classRows: ClassRow[] = (b.classes ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((c) => ({
          name: c.name,
          color: c.color ?? defaultColorFor(c.name),
          ...(c.alias ? { alias: c.alias } : {}),
        }));
      out[k] = {
        enabled: !!b.enabled,
        classRows,
        attributeFields:
          (b.attribute_schema as AttributeSchema | undefined)?.fields ?? [],
      };
    }
    return out;
  }

  // 兜底: 老项目从扁平 classes_config / attribute_schema 派生到默认 unit
  const defaultUnit = toolUnitFromLegacy(project.type_key ?? "image-det");
  const cfg = (project.classes_config ?? {}) as ClassesConfig;
  const ordered = [...(project.classes ?? [])].sort((a, b) => {
    const oa = cfg[a]?.order ?? 0;
    const ob = cfg[b]?.order ?? 0;
    return oa - ob;
  });
  const classRows: ClassRow[] = ordered.map((name) => {
    const c: ClassConfigEntry | undefined = cfg[name];
    return {
      name,
      color: c?.color ?? defaultColorFor(name),
      ...(c?.alias ? { alias: c.alias } : {}),
    } as ClassRow;
  });
  out[defaultUnit] = {
    enabled: true,
    classRows,
    attributeFields: project.attribute_schema?.fields ?? [],
  };
  return out;
}

/** 把 UnitBindingMap 序列化为后端 PATCH 体的 tool_bindings 字段 (仅 enabled 单位). */
export function unitBindingsToPayload(bindings: UnitBindingMap): ToolBindings {
  const out: ToolBindings = {};
  for (const k of Object.keys(bindings) as ToolUnitId[]) {
    const ub = bindings[k];
    if (!ub || !ub.enabled) continue;
    out[k] = {
      enabled: true,
      classes: ub.classRows.map((r, i) => ({
        name: r.name,
        color: r.color,
        order: i,
        ...(r.alias ? { alias: r.alias } : {}),
      })),
      attribute_schema:
        ub.attributeFields.length > 0
          ? { fields: ub.attributeFields }
          : { fields: [] },
    };
  }
  return out;
}

/** Section / Modal 端共用的状态管理 hook. */
export function useProjectToolBindings(project: ProjectResponse) {
  const initial = useMemo(() => buildUnitBindings(project), [project]);
  const [bindings, setBindings] = useState<UnitBindingMap>(initial);
  const [activeUnit, setActiveUnit] = useState<ToolUnitId>(() => {
    const firstEnabled = (Object.keys(initial) as ToolUnitId[]).find(
      (k) => initial[k]?.enabled,
    );
    return firstEnabled ?? "bbox";
  });

  useEffect(() => {
    setBindings(initial);
  }, [initial]);

  const dirty = JSON.stringify(bindings) !== JSON.stringify(initial);

  return {
    bindings,
    setBindings,
    activeUnit,
    setActiveUnit,
    dirty,
    initial,
  };
}
