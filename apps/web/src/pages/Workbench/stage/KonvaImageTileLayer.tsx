import { useCallback, useEffect, useRef } from "react";
import { Layer, Shape } from "react-konva";
import type Konva from "konva";
import type { LoadedImageTile } from "./imageTileScheduler";

interface KonvaImageTileLayerProps {
  overviewImage?: CanvasImageSource | null;
  imageWidth: number;
  imageHeight: number;
  tiles: readonly LoadedImageTile[];
  imageSmoothingEnabled: boolean;
}

export function KonvaImageTileLayer({
  overviewImage,
  imageWidth,
  imageHeight,
  tiles,
  imageSmoothingEnabled,
}: KonvaImageTileLayerProps) {
  const layerRef = useRef<Konva.Layer>(null);
  const drawTiles = useCallback<NonNullable<Konva.ShapeConfig["sceneFunc"]>>(
    (context) => {
      const previousSmoothing = context.imageSmoothingEnabled;
      context.imageSmoothingEnabled = imageSmoothingEnabled;
      if (overviewImage) {
        context.drawImage(overviewImage, 0, 0, imageWidth, imageHeight);
      }
      for (const tile of tiles) {
        context.drawImage(
          tile.image,
          tile.crop.x,
          tile.crop.y,
          tile.crop.width,
          tile.crop.height,
          tile.world.x,
          tile.world.y,
          tile.world.width,
          tile.world.height,
        );
      }
      context.imageSmoothingEnabled = previousSmoothing;
    },
    [imageHeight, imageSmoothingEnabled, imageWidth, overviewImage, tiles],
  );
  useEffect(() => {
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 16);
    const cancel =
      typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : window.clearTimeout;
    const frame = schedule(() => layerRef.current?.batchDraw());
    return () => cancel(frame);
  }, [drawTiles]);

  return (
    <Layer ref={layerRef} name="image-tiles" listening={false}>
      <Shape
        width={imageWidth}
        height={imageHeight}
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={drawTiles}
      />
    </Layer>
  );
}
