import { Image as KonvaImage, Layer } from "react-konva";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { VideoMaskRenderRecord } from "./videoMaskFrames";

export function VideoKonvaMaskLayer(props: {
  records: readonly VideoMaskRenderRecord[];
  size: VideoPixelSize;
}) {
  const { records, size } = props;
  return (
    <Layer name="video-mask-layer" listening={false}>
      {[...records]
        .sort((a, b) => a.zOrder - b.zOrder)
        .map((record) => (
          <KonvaImage
            key={record.cacheKey}
            image={record.image}
            width={size.w}
            height={size.h}
            opacity={record.source === "tracker" ? 0.5 : record.selected ? 0.58 : 0.38}
            listening={false}
          />
        ))}
    </Layer>
  );
}
