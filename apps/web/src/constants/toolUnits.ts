/**
 * v0.10.17 · 工具维度类别 / 属性绑定 — 前端常量与映射.
 *
 * 与后端 ``app/schemas/_jsonb_types.py`` 中 ``ToolUnitId`` Literal 完全对齐.
 * 新增 unit 时两端同步;codegen 派生的 schema 仍是 dict<string, ToolBinding>,
 * 前端用此模块的 Literal type 收窄校验.
 */

import type { IconName } from "@/components/ui/Icon";

export type ToolUnitId =
  | "bbox"
  | "polyline"
  | "region"
  | "ai_interactive"
  | "lidar_box_3d";

export const TOOL_UNIT_IDS: ReadonlyArray<ToolUnitId> = [
  "bbox",
  "polyline",
  "region",
  "ai_interactive",
  "lidar_box_3d",
];

export interface ToolUnitGroupSpec {
  id: ToolUnitId;
  label: string;
  hint: string;
  icon: IconName;
  /** unit 包含的具体绘制工具 (Workbench ToolId), 仅 UI 文案展示用 */
  tools: ReadonlyArray<string>;
  /** 哪些数据类型可启用 (image / video / lidar) */
  dataTypes: ReadonlyArray<ProjectDataType>;
  /** 本版是否已实现 (false = 占位置灰) */
  available: boolean;
}

export type ProjectDataType = "image" | "video" | "lidar";

export interface ProjectDataTypeSpec {
  id: ProjectDataType;
  label: string;
  hint: string;
  icon: IconName;
  /** 兼容旧 type_key 默认值 (新建项目时 form.typeKey 的初值) */
  legacyTypeKey: string;
}

export const PROJECT_DATA_TYPES: ReadonlyArray<ProjectDataTypeSpec> = [
  {
    id: "image",
    label: "图片",
    hint: "图像 · 单张图片标注",
    icon: "image",
    legacyTypeKey: "image-det",
  },
  {
    id: "video",
    label: "视频",
    hint: "视频 · 帧序列标注",
    icon: "video",
    legacyTypeKey: "video-track",
  },
  {
    id: "lidar",
    label: "3D 点云",
    hint: "激光点云 (本版占位)",
    icon: "cube",
    legacyTypeKey: "lidar",
  },
];

export const TOOL_UNIT_GROUPS: ReadonlyArray<ToolUnitGroupSpec> = [
  {
    id: "bbox",
    label: "矩形框 (bbox)",
    hint: "拖框圈选;基础几何",
    icon: "rect",
    tools: ["box"],
    dataTypes: ["image", "video"],
    available: true,
  },
  {
    id: "polyline",
    label: "折线 (polyline)",
    hint: "本版未实现, schema 留位",
    icon: "polygon",
    tools: ["polyline"],
    dataTypes: ["image", "video"],
    available: false,
  },
  {
    id: "region",
    label: "区域 (polygon + mask)",
    hint: "多边形与笔刷掩码打包;实例分割",
    icon: "polygon",
    tools: ["polygon", "mask"],
    dataTypes: ["image"],
    available: true,
  },
  {
    id: "ai_interactive",
    label: "AI 交互",
    hint: "SAM 点 / 框 / 文本 / 示例 + Magic Box 打包",
    icon: "brain",
    tools: ["smart-point", "smart-box", "text-prompt", "exemplar", "magic-box"],
    dataTypes: ["image"],
    available: true,
  },
  {
    id: "lidar_box_3d",
    label: "3D 立体框",
    hint: "本版未实现, schema 留位",
    icon: "cube",
    tools: ["lidar_box"],
    dataTypes: ["lidar"],
    available: false,
  },
];

export function getToolUnitGroup(id: ToolUnitId): ToolUnitGroupSpec | undefined {
  return TOOL_UNIT_GROUPS.find((g) => g.id === id);
}

/** 给定数据类型, 推荐默认启用的 unit 集合. */
export function defaultEnabledUnits(dt: ProjectDataType): ToolUnitId[] {
  if (dt === "video") return ["bbox"];
  if (dt === "lidar") return ["lidar_box_3d"];
  // image 默认: bbox + region 两个开 (覆盖检测 / 分割 90% 场景), AI 交互按 AI 开关再开
  return ["bbox", "region"];
}

/** 兼容: 把 legacy type_key 推导到 data_type. */
export function dataTypeFromLegacy(typeKey: string): ProjectDataType {
  if (typeKey.startsWith("video")) return "video";
  if (typeKey === "lidar") return "lidar";
  return "image";
}

/** 兼容: 把 legacy type_key 推导到默认 tool_unit (与后端 migration 0072 同规则). */
export function toolUnitFromLegacy(typeKey: string): ToolUnitId {
  if (typeKey === "image-seg") return "region";
  if (typeKey === "lidar") return "lidar_box_3d";
  return "bbox";
}
