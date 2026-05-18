import { useEffect, useRef } from "react";
import type { CachedVideoBitmap } from "./useVideoBitmapCache";
import styles from "./VideoBitmapLayer.module.css";

interface VideoBitmapLayerProps {
  bitmap: CachedVideoBitmap | null;
  visible: boolean;
}

export function VideoBitmapLayer({ bitmap, visible }: VideoBitmapLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap.bitmap, 0, 0, bitmap.width, bitmap.height);
  }, [bitmap]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="video-bitmap-layer"
      aria-hidden="true"
      className={visible && bitmap ? styles.layerVisible : styles.layerHidden}
    />
  );
}
