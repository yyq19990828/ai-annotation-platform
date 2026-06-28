import { useMemo } from "react";
import type { MLModelCapability } from "@/api/ml-backends";
import type { AttributeSchema, ToolBindings } from "@/api/projects";
import type { ToolUnitId } from "@/constants/toolUnits";

// v0.14.9 · 能力声明协议 v2 — active model 与项目配置的兼容性校验 (非阻断, 仅警告).
//
// 两类检查:
//   1) 几何兼容: active model 的 supported_geometric_outputs 是否落在项目启用的 tool_unit 几何里.
//      OCR/doc_layout 不产生标准几何 (text / bbox 版面框), 只校验「项目能否承接该几何」.
//   2) 文本属性: model.output_attribute_types 含 "text" (OCR 文本输出) 时,
//      项目是否在某个启用 unit 的 attribute_schema 配了 type=text 属性来承接识别文本.
//
// 任一不满足时返回一条 warning; 上层在 InteractiveToolBar / AIInspectorPanel 以非阻断条幅展示.

export interface CapabilityWarning {
  /** 稳定 key, 供 React list + 去重. */
  key: string;
  /** 中文提示文案 (硬编码). */
  message: string;
}

// model 几何输出名 → 项目 tool_unit 几何能力的映射.
// model.supported_geometric_outputs 用 grounded-sam2 / 协议 v2 的命名 (bbox/polygon/mask/...),
// 项目侧用 ToolUnitId. 一个几何能被多个 unit 承接, 故值是 unit 集合.
const GEOMETRY_TO_UNITS: Record<string, ToolUnitId[]> = {
  bbox: ["bbox"],
  rectangle: ["bbox"],
  rotated_bbox: ["rotated_bbox"],
  obb: ["rotated_bbox"],
  polygon: ["region"],
  mask: ["region"],
  segmentation: ["region"],
  polyline: ["polyline"],
  line: ["polyline"],
  keypoint: ["keypoint"],
  pose: ["keypoint"],
  box_3d: ["lidar_box_3d"],
  point_mask: ["point_mask_3d"],
};

const GEOMETRY_LABEL: Record<string, string> = {
  bbox: "矩形框",
  rectangle: "矩形框",
  rotated_bbox: "旋转框",
  obb: "旋转框",
  polygon: "多边形",
  mask: "掩码",
  segmentation: "分割",
  polyline: "折线",
  line: "折线",
  keypoint: "关键点",
  pose: "姿态",
  box_3d: "3D 框",
  point_mask: "点云掩码",
};

function schemaHasTextField(schema: AttributeSchema | undefined): boolean {
  return (schema?.fields ?? []).some((f) => f.type === "text");
}

export interface UseCapabilityValidationArgs {
  /** 当前 active model; 无 model (单模型老 backend 或未拉到能力) 时不产警告. */
  activeModel: MLModelCapability | undefined;
  /** 项目启用的 tool_unit 集合 (来自 enabledToolUnits); null = 老项目无显式启用配置, 跳过几何校验. */
  enabledToolUnits: Set<string> | null;
  /** 项目 tool_bindings, 用来取各 unit 的 attribute_schema 判断文本属性. */
  toolBindings: ToolBindings | undefined;
}

/**
 * 返回 active model 与项目配置的兼容性警告数组 (可能为空).
 * 纯派生, 无副作用; 由 InteractiveToolBar / AIInspectorPanel 展示.
 */
export function useCapabilityValidation({
  activeModel,
  enabledToolUnits,
  toolBindings,
}: UseCapabilityValidationArgs): CapabilityWarning[] {
  return useMemo<CapabilityWarning[]>(() => {
    if (!activeModel) return [];
    const warnings: CapabilityWarning[] = [];
    const modelLabel = activeModel.display_name || activeModel.id;

    // 1) 几何兼容: 仅当项目有显式启用 unit 集合时校验 (老项目 enabledToolUnits=null 跳过).
    if (enabledToolUnits && enabledToolUnits.size > 0) {
      const geoms = activeModel.supported_geometric_outputs ?? [];
      const unmatched = geoms.filter((g) => {
        const units = GEOMETRY_TO_UNITS[g];
        // 未知几何名: 无法判断, 不报警 (避免协议新增几何时误报).
        if (!units) return false;
        return !units.some((u) => enabledToolUnits.has(u));
      });
      for (const g of unmatched) {
        warnings.push({
          key: `geom-${g}`,
          message: `模型「${modelLabel}」输出${GEOMETRY_LABEL[g] ?? g}，但当前项目未启用对应的标注工具，采纳后可能无法落库。`,
        });
      }
    }

    // 2) 文本属性: model 产出文本 (output_attribute_types 含 "text") 时, 项目需有 text 属性承接.
    const outputsText = (activeModel.output_attribute_types ?? []).includes("text");
    if (outputsText) {
      const unitsToCheck = enabledToolUnits && enabledToolUnits.size > 0
        ? [...enabledToolUnits]
        : Object.keys(toolBindings ?? {});
      const anyTextField = unitsToCheck.some((unit) =>
        schemaHasTextField(toolBindings?.[unit as ToolUnitId]?.attribute_schema ?? undefined),
      );
      if (!anyTextField) {
        warnings.push({
          key: "text-attr",
          message: `模型「${modelLabel}」会输出识别文本，但当前项目未配置文本（text）属性，采纳后文本将丢失。请在项目设置中为对应工具添加 text 属性。`,
        });
      }
    }

    return warnings;
  }, [activeModel, enabledToolUnits, toolBindings]);
}
