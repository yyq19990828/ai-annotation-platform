import { Group, Image as KonvaImage, Label, Tag, Text } from "react-konva";
import { BOX_LABEL_FONT_FAMILY, BOX_LABEL_PAD_PX, labelOffsetWorld } from "./boxVisual";
import type { AnnotationVisualConfig } from "./annotationVisual";

interface RasterMaskVisualProps {
  id: string;
  image: CanvasImageSource;
  bounds: { x: number; y: number; w: number; h: number };
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  color: string;
  selected: boolean;
  opacity: number;
  visual: AnnotationVisualConfig;
  labelText?: string | null;
  showLabel?: boolean;
}

/** Mask 选中态沿真实像素轮廓增亮，不再用容易被误解为矩形标注的 AABB 虚线框。 */
export function maskVisualOpacity(opacity: number, selected: boolean): number {
  const normalized = Math.max(0, Math.min(1, opacity));
  return selected ? Math.min(0.72, normalized + 0.18) : normalized;
}

export function RasterMaskVisual({
  id,
  image,
  bounds,
  sourceWidth,
  sourceHeight,
  scale,
  color,
  selected,
  opacity,
  visual,
  labelText,
  showLabel = false,
}: RasterMaskVisualProps) {
  const x = bounds.x * sourceWidth;
  const y = bounds.y * sourceHeight;
  const width = bounds.w * sourceWidth;
  const height = bounds.h * sourceHeight;
  const resolvedOpacity = maskVisualOpacity(opacity, selected);

  return (
    <Group id={id} name="raster-mask-annotation" listening={false}>
      <KonvaImage
        name="raster-mask-fill"
        image={image}
        x={x}
        y={y}
        width={width}
        height={height}
        opacity={resolvedOpacity}
        imageSmoothingEnabled={false}
        shadowEnabled={selected}
        shadowColor={color}
        shadowBlur={selected ? 3 / scale : 0}
        shadowOpacity={selected ? 0.9 : 0}
        listening={false}
      />
      {showLabel && labelText && (
        <Label
          name="raster-mask-label"
          x={x}
          y={y - labelOffsetWorld(visual.labelFontSize, scale)}
          listening={false}
        >
          <Tag fill={color} cornerRadius={3 / scale} />
          <Text
            text={labelText}
            fill="white"
            fontSize={visual.labelFontSize / scale}
            padding={BOX_LABEL_PAD_PX / scale}
            fontFamily={BOX_LABEL_FONT_FAMILY}
          />
        </Label>
      )}
    </Group>
  );
}
