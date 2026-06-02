import type { ProjectResponse, ToolBindings } from "@/api/projects";
import {
  TOOL_UNIT_GROUPS,
  dataTypeFromLegacy,
  toolUnitFromLegacy,
  type ProjectDataType,
  type ToolUnitId,
} from "@/constants/toolUnits";

const DATA_TYPE_LABELS: Record<ProjectDataType, string> = {
  image: "图片",
  video: "视频",
  lidar: "3D 点云",
};

const TOOL_UNIT_LABELS: Record<ToolUnitId, string> = {
  bbox: "矩形框",
  polyline: "折线",
  keypoint: "关键点",
  region: "区域",
  ai_interactive: "AI 交互",
  lidar_box_3d: "3D 立体框",
  rotated_bbox: "旋转框",
};

export function projectDataType(project: Pick<ProjectResponse, "data_type" | "type_key">): ProjectDataType {
  if (
    project.data_type === "image" ||
    project.data_type === "video" ||
    project.data_type === "lidar"
  ) {
    return project.data_type;
  }
  return dataTypeFromLegacy(project.type_key ?? "image-det");
}

export function projectDisplayType(project: ProjectResponse): string {
  const dataType = projectDataType(project);
  const toolLabels = projectToolLabels(project, dataType);
  const dataTypeLabel = DATA_TYPE_LABELS[dataType];
  if (toolLabels.length === 0) return dataTypeLabel;
  return `${dataTypeLabel} · ${toolLabels.join(" / ")}`;
}

function projectToolLabels(project: ProjectResponse, dataType: ProjectDataType): string[] {
  const bindings = (project.tool_bindings ?? {}) as ToolBindings;
  const labels: string[] = [];

  for (const group of TOOL_UNIT_GROUPS) {
    if (!group.dataTypes.includes(dataType)) continue;
    const unitId = group.id;
    const binding = bindings[unitId];
    if (!binding?.enabled) continue;
    labels.push(unitDisplayLabel(unitId, dataType, binding.video_modes ?? null));
  }

  if (labels.length > 0 || Object.keys(bindings).length > 0) return labels;

  const fallbackUnit = toolUnitFromLegacy(project.type_key ?? "image-det");
  const fallbackGroup = TOOL_UNIT_GROUPS.find((group) => group.id === fallbackUnit);
  if (fallbackGroup?.dataTypes.includes(dataType)) {
    return [unitDisplayLabel(fallbackUnit, dataType, null)];
  }

  return [];
}

function unitDisplayLabel(
  unitId: ToolUnitId,
  dataType: ProjectDataType,
  videoModes: { box?: boolean; track?: boolean } | null,
): string {
  if (dataType === "video" && unitId === "bbox") {
    if (!videoModes || (videoModes.box !== false && videoModes.track !== false)) {
      return "单帧框 / 轨迹框";
    }
    if (videoModes.box !== false) return "单帧框";
    if (videoModes.track !== false) return "轨迹框";
  }
  return TOOL_UNIT_LABELS[unitId];
}
