import type { AnnotationResponse } from "@/types";
import { rasterMasksApi } from "@/api/rasterMasks";
import { classColorForCanvas } from "../stage/colors";
import type { RasterMaskRecordDescriptor } from "../stage/shared/useRasterMaskRecords";

export function buildImageRasterMaskDescriptors(
  annotations: readonly AnnotationResponse[],
  selectedIds: ReadonlySet<string>,
): RasterMaskRecordDescriptor<"annotation">[] {
  return annotations.flatMap((annotation) => {
    // Optimistic creates have uploaded content, but no readable annotation endpoint yet.
    if (annotation.geometry.type !== "raster_mask" || annotation.id.startsWith("tmp_")) return [];
    const color = classColorForCanvas(annotation.class_name);
    return [
      {
        id: annotation.id,
        source: "annotation" as const,
        ref: annotation.geometry.mask,
        revision: annotation.version ?? annotation.geometry.mask.sha256,
        color,
        colorRevision: color,
        zOrder: annotation.z_order ?? 0,
        selected: selectedIds.has(annotation.id),
        load: () => rasterMasksApi.annotationRasterMaskContent(annotation.id),
      },
    ];
  });
}
