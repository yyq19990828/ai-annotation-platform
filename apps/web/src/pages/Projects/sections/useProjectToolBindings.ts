/**
 * v0.10.17 · ClassesSection / TemplateEditModal 共享 hook.
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
  dataTypeFromLegacy,
  toolUnitFromLegacy,
  type ProjectDataType,
  type ToolUnitId,
} from "@/constants/toolUnits";

export interface UnitBindingState {
  enabled: boolean;
  classRows: ClassRow[];
  attributeFields: AttributeField[];
  /** v0.10.28 · 仅 keypoint 单元用：骨骼模板 (命名节点 + 连线)。 */
  keypointSchema?: import("@/types").KeypointSchema | null;
}

export type UnitBindingMap = Partial<Record<ToolUnitId, UnitBindingState>>;

export function buildUnitBindings(project: {
  data_type?: string | null;
  type_key?: string;
  classes?: string[];
  classes_config?: ClassesConfig | null;
  attribute_schema?: AttributeSchema | null;
  tool_bindings?: ToolBindings | null;
}): UnitBindingMap {
  const dataType = projectDataType(project);
  const out: UnitBindingMap = {};
  for (const g of TOOL_UNIT_GROUPS) {
    if (!g.available) continue;
    if (!g.dataTypes.includes(dataType)) continue;
    out[g.id] = { enabled: false, classRows: [], attributeFields: [] };
  }

  const tb = (project.tool_bindings ?? {}) as ToolBindings;
  if (Object.keys(tb).length > 0) {
    for (const k of Object.keys(tb) as ToolUnitId[]) {
      const b = tb[k];
      if (!b) continue;
      if (!out[k]) continue;
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
        keypointSchema: b.keypoint_schema ?? null,
      };
    }
    return out;
  }

  // 兜底: 老项目从扁平 classes_config / attribute_schema 派生到默认 unit
  const legacyUnit = toolUnitFromLegacy(project.type_key ?? "image-det");
  const defaultUnit = out[legacyUnit]
    ? legacyUnit
    : (Object.keys(out)[0] as ToolUnitId | undefined);
  if (!defaultUnit) return out;
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

function projectDataType(project: {
  data_type?: string | null;
  type_key?: string;
}): ProjectDataType {
  if (
    project.data_type === "image" ||
    project.data_type === "video" ||
    project.data_type === "lidar"
  ) {
    return project.data_type;
  }
  return dataTypeFromLegacy(project.type_key ?? "image-det");
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
      // v0.10.28 · keypoint 单元附带骨骼模板 (后端 ToolBinding.keypoint_schema 就位前不落库)。
      ...(k === "keypoint" && ub.keypointSchema
        ? { keypoint_schema: ub.keypointSchema }
        : {}),
    };
  }
  return out;
}

/** Section / Modal 端共用的状态管理 hook. */
export function useProjectToolBindings(project: ProjectResponse) {
  const initial = useMemo(() => buildUnitBindings(project), [project]);
  const [bindings, setBindings] = useState<UnitBindingMap>(initial);
  const [activeUnit, setActiveUnit] = useState<ToolUnitId>(() =>
    firstActiveUnit(initial),
  );

  useEffect(() => {
    setBindings(initial);
    setActiveUnit((cur) => initial[cur] ? cur : firstActiveUnit(initial));
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

function firstActiveUnit(bindings: UnitBindingMap): ToolUnitId {
  const firstEnabled = (Object.keys(bindings) as ToolUnitId[]).find(
    (k) => bindings[k]?.enabled,
  );
  return firstEnabled
    ?? ((Object.keys(bindings)[0] as ToolUnitId | undefined) ?? "bbox");
}
