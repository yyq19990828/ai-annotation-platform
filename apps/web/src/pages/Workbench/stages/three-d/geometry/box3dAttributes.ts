import type { AttributeSchema, ToolBindings } from "@/api/projects";

export const LIDAR_BOX_3D_TOOL_UNIT = "lidar_box_3d";

export function box3dAttributeSchema(
  toolBindings: ToolBindings | undefined | null,
): AttributeSchema | undefined {
  const binding = toolBindings?.[LIDAR_BOX_3D_TOOL_UNIT];
  if (!binding || binding.enabled === false) return undefined;
  return binding.attribute_schema;
}
