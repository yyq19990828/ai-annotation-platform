import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Image as KonvaImage, Layer } from "react-konva";
import {
  MaskCompareStaleGenerationError,
  type MaskCompareRenderableTile,
  type MaskCompareTileStore,
  type MaskCompareViewportRect,
} from "../shared/maskCompareTileStore";

const BASELINE = [217, 70, 239] as const;
const CURRENT = [6, 182, 212] as const;
const OVERLAP = [245, 158, 11] as const;

export function colorizeMaskCompareCodes(codes: Uint8Array, opacity = 0.72): Uint8ClampedArray {
  const output = new Uint8ClampedArray(codes.length * 4);
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  for (let index = 0; index < codes.length; index += 1) {
    const color =
      codes[index] === 1
        ? BASELINE
        : codes[index] === 2
          ? CURRENT
          : codes[index] === 3
            ? OVERLAP
            : null;
    if (!color) continue;
    const offset = index * 4;
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
    output[offset + 3] = alpha;
  }
  return output;
}

function TileImage({ tile }: { tile: MaskCompareRenderableTile }) {
  const canvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const value = document.createElement("canvas");
    value.width = tile.rasterWidth;
    value.height = tile.rasterHeight;
    return value;
  }, [tile.rasterHeight, tile.rasterWidth]);
  const imageRef = useRef<Konva.Image | null>(null);
  useEffect(() => {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const image = context.createImageData(tile.rasterWidth, tile.rasterHeight);
    image.data.set(colorizeMaskCompareCodes(tile.codes));
    context.putImageData(image, 0, 0);
    imageRef.current?.getLayer()?.batchDraw();
  }, [canvas, tile.codes, tile.rasterHeight, tile.rasterWidth]);
  if (!canvas) return null;
  return (
    <KonvaImage
      ref={imageRef}
      image={canvas}
      x={tile.x}
      y={tile.y}
      width={tile.width}
      height={tile.height}
      imageSmoothingEnabled={false}
      listening={false}
    />
  );
}

export function MaskCompareTileLayer({
  store,
  viewport,
}: {
  store: MaskCompareTileStore | null | undefined;
  viewport: MaskCompareViewportRect | null | undefined;
}) {
  const [loaded, setLoaded] = useState<{
    store: MaskCompareTileStore;
    mode: MaskCompareTileStore["mode"];
    tiles: MaskCompareRenderableTile[];
  } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const storeMode = store?.mode;
  const signature = store && viewport ? store.viewportSignature(viewport) : null;
  useEffect(() => {
    if (!store || !signature || !viewportRef.current) {
      setLoaded(null);
      return;
    }
    setLoaded((current) =>
      current && (current.store !== store || current.mode !== storeMode) ? null : current,
    );
    let active = true;
    const run = () => {
      const currentViewport = viewportRef.current;
      if (!currentViewport) return;
      void store
        .loadViewport(currentViewport)
        .then((next) => {
          if (active) setLoaded({ store, mode: store.mode, tiles: next });
        })
        .catch((error: unknown) => {
          if (!active || error instanceof MaskCompareStaleGenerationError) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLoaded(null);
        });
    };
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : null;
    if (frame === null) run();
    return () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [signature, store, storeMode]);
  if (!store || loaded?.store !== store || loaded.mode !== store.mode || loaded.tiles.length === 0)
    return null;
  return (
    <Layer name="mask-compare" listening={false}>
      {loaded.tiles.map((tile) => (
        <TileImage key={tile.key} tile={tile} />
      ))}
    </Layer>
  );
}
