import { classColor } from "./colors";

interface Drawing {
  x: number; y: number; w: number; h: number;
}

export function DrawingPreview({ drawing, activeClass }: { drawing: Drawing | null; activeClass: string }) {
  if (!drawing || drawing.w <= 0) return null;
  const color = classColor(activeClass);
  return (
    <div
      style={{
        position: "absolute",
        left: drawing.x * 100 + "%", top: drawing.y * 100 + "%",
        width: drawing.w * 100 + "%", height: drawing.h * 100 + "%",
        border: "1.5px dashed " + color,
        background: color + "20",
      }}
    />
  );
}
