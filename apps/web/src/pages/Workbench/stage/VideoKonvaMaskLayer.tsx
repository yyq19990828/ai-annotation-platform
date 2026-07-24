import { Layer } from "react-konva";
import type { AnnotationVisualConfig } from "./annotationVisual";
import { RasterMaskVisual } from "./RasterMaskVisual";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { VideoMaskRenderRecord } from "./videoMaskFrames";

export function VideoKonvaMaskLayer(props: {
  records: readonly VideoMaskRenderRecord[];
  size: VideoPixelSize;
  scale: number;
  visual: AnnotationVisualConfig;
}) {
  const { records, size, scale, visual } = props;
  return (
    <Layer name="video-mask-layer" listening={false}>
      {[...records]
        .sort((a, b) => a.zOrder - b.zOrder)
        .map((record) => (
          <RasterMaskVisual
            key={record.cacheKey}
            id={record.id}
            image={record.image}
            bounds={record.geom}
            sourceWidth={size.w}
            sourceHeight={size.h}
            scale={scale}
            color={record.color}
            selected={record.selected}
            visual={visual}
          />
        ))}
    </Layer>
  );
}
