import type { AnnotationPayload } from "@/api/tasks";
import type { AnnotationResponse, Box3DGeometry } from "@/types";

export interface ClipboardBox3D {
  class_name: string;
  geometry: Box3DGeometry;
  attributes?: Record<string, unknown>;
}

function cloneGeometry(geometry: Box3DGeometry): Box3DGeometry {
  return {
    ...geometry,
    center: [...geometry.center],
    size: [...geometry.size],
    rotation: [...geometry.rotation],
  };
}

export function serializeBox3D(
  annotation: AnnotationResponse | null | undefined,
): ClipboardBox3D | null {
  const geometry = annotation?.geometry;
  if (!annotation || geometry?.type !== "box_3d") return null;
  return {
    class_name: annotation.class_name,
    geometry: cloneGeometry(geometry),
    attributes: annotation.attributes ? { ...annotation.attributes } : undefined,
  };
}

export function pasteOffsetPayload(
  clip: ClipboardBox3D,
  offset: [number, number, number] = [2, 2, 0],
): AnnotationPayload {
  const geometry = cloneGeometry(clip.geometry);
  geometry.center = [
    geometry.center[0] + offset[0],
    geometry.center[1] + offset[1],
    geometry.center[2] + offset[2],
  ];
  return {
    annotation_type: "box_3d",
    tool_unit_id: "lidar_box_3d",
    class_name: clip.class_name,
    geometry,
    attributes: clip.attributes ? { ...clip.attributes } : undefined,
  };
}
