import { useEffect, useRef } from "react";
import { classColor } from "./colors";
import styles from "./DrawingPreview.module.css";

interface Drawing {
  x: number; y: number; w: number; h: number;
}

export function DrawingPreview({ drawing, activeClass }: { drawing: Drawing | null; activeClass: string }) {
  if (!drawing || drawing.w <= 0) return null;
  const color = classColor(activeClass);
  const left = drawing.x * 100 + "%";
  const top = drawing.y * 100 + "%";
  const width = drawing.w * 100 + "%";
  const height = drawing.h * 100 + "%";
  return (
    <DrawingPreviewBox left={left} top={top} width={width} height={height} color={color} />
  );
}

function DrawingPreviewBox({
  left,
  top,
  width,
  height,
  color,
}: {
  left: string;
  top: string;
  width: string;
  height: string;
  color: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--drawing-left", left);
    el.style.setProperty("--drawing-top", top);
    el.style.setProperty("--drawing-width", width);
    el.style.setProperty("--drawing-height", height);
    el.style.setProperty("--drawing-color", color);
  }, [color, height, left, top, width]);

  return <div ref={ref} className={styles.preview} />;
}
