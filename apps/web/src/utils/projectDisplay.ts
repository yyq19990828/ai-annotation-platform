import type { ProjectResponse } from "@/api/projects";
import { dataTypeFromLegacy, type ProjectDataType } from "@/constants/toolUnits";

const DATA_TYPE_LABELS: Record<ProjectDataType, string> = {
  image: "图片",
  video: "视频",
  lidar: "3D 点云",
};

export function projectDataType(
  project: Pick<ProjectResponse, "data_type" | "type_key">,
): ProjectDataType {
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
  return DATA_TYPE_LABELS[projectDataType(project)];
}
